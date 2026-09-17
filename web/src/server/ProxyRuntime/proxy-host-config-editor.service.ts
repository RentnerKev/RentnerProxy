import '@tanstack/react-start/server-only'

import type { z } from 'zod'

import { PERMISSIONS } from '../../config/permissions.config'
import {
    normalizeProxyHostHttpSettings,
    proxyHostConfigEditorIdSchema,
    proxyHostConfigEditorSaveSchema,
    proxyHostConfigEditorResetSchema,
} from '../../features/Admin/ProxyHostManagement/config-validation'
import type {
    ProxyHostConfigEditorData,
    ProxyHttpSettings,
    ProxyRuntimeMutationStatus,
} from '../../shared/Types/proxy-runtime.types'
import { requirePermissionService } from '../Auth/Access/authorization.service'
import { requirePermissionInTransaction } from '../Auth/Access/rbac.service'
import { getAuthDatabase, type AuthTransaction } from '../Auth/Core/database.server'
import { getActiveProxyHostConfiguration } from '../Foundation/controller.server'
import { ProxyConfigEditorError } from './proxy-config-editor.service'
import { readProxyRuntimeHost, readProxyRuntimeTrustedCas } from './proxy-runtime-data'
import { createProxyRuntimeSnapshot } from './proxy-runtime-snapshot'
import {
    lockProxyRuntimeSettings,
    readProxyHttpSettings,
    readProxyHostHttpSettings,
    writeProxyHostHttpSettings,
} from './proxy-runtime-settings'
import { reconcileProxyConfigurationWithAudit } from './proxy-runtime.service'
import { appendAuditEventInTransaction } from '../Audit/audit.service'
import { recordMutationFailureBestEffort } from './audit-mutation'

async function readHostEditorState(transaction: AuthTransaction, proxyHostId: string) {
    const host = await readProxyRuntimeHost(transaction, proxyHostId)
    if (!host) throw new ProxyConfigEditorError('host_not_found')
    const httpSettings = await readProxyHttpSettings(transaction)
    const hostSettings = await readProxyHostHttpSettings(transaction, host.id)
    const trustedCas = await readProxyRuntimeTrustedCas(transaction, [host])
    const snapshot = createProxyRuntimeSnapshot(
        [{ ...host, enabled: true, httpSettings: hostSettings }],
        httpSettings,
        trustedCas,
    )

    const baseRevision =
        'sha256:' +
        new Bun.CryptoHasher('sha256')
            .update(
                JSON.stringify({ version: 7, enabled: host.enabled, revision: snapshot.revision }),
            )
            .digest('hex')
    return { host, httpSettings, hostSettings, trustedCas, snapshot, baseRevision }
}

async function loadHostEditorState(proxyHostId: string, actorId: string) {
    return getAuthDatabase().transaction(
        async (transaction) => {
            await requirePermissionInTransaction(transaction, actorId, PERMISSIONS.PROXY_HOSTS_VIEW)
            return {
                ...(await readHostEditorState(transaction, proxyHostId)),
            }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
}

export async function getProxyHostConfigEditorService(
    proxyHostId: string,
): Promise<ProxyHostConfigEditorData> {
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
    const id = proxyHostConfigEditorIdSchema.parse({ proxyHostId }).proxyHostId
    const state = await loadHostEditorState(id, actor.id)

    const active = await getActiveProxyHostConfiguration(id)
    return {
        proxyHostId: id,
        hostLabel: state.host.domains[0] ?? state.host.forwardHost,
        enabled: state.host.enabled,
        baseRevision: state.baseRevision,
        settings: state.hostSettings,
        inheritedSettings: state.httpSettings,
        active,
    }
}

async function saveHostSettings(
    proxyHostId: string,
    baseRevision: string,
    settings: ProxyHttpSettings,
    action: 'save' | 'reset',
): Promise<{ readonly enabled: boolean; readonly runtimeStatus: ProxyRuntimeMutationStatus }> {
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    let enabled: boolean
    try {
        enabled = await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.PROXY_HOSTS_UPDATE,
            )
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.PROXY_HOSTS_APPLY,
            )
            const latest = await readHostEditorState(transaction, proxyHostId)
            if (latest.baseRevision !== baseRevision)
                throw new ProxyConfigEditorError('configuration_conflict')
            await writeProxyHostHttpSettings(transaction, proxyHostId, settings)
            await appendAuditEventInTransaction(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action,
                resource: 'proxy-host-settings',
                targetId: proxyHostId,
                result: 'success',
            })
            return latest.host.enabled
        })
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action,
            resource: 'proxy-host-settings',
            targetId: proxyHostId,
            error,
        })
        throw error
    }
    return { enabled, runtimeStatus: await reconcileProxyConfigurationWithAudit(actor.id) }
}

export async function saveProxyHostConfigEditorService(
    input: z.input<typeof proxyHostConfigEditorSaveSchema>,
) {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    const parsed = proxyHostConfigEditorSaveSchema.parse(input)
    return saveHostSettings(
        parsed.proxyHostId,
        parsed.baseRevision,
        normalizeProxyHostHttpSettings(parsed.settings),
        'save',
    )
}

export async function resetProxyHostConfigEditorService(
    input: z.input<typeof proxyHostConfigEditorResetSchema>,
) {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    const parsed = proxyHostConfigEditorResetSchema.parse(input)
    return saveHostSettings(parsed.proxyHostId, parsed.baseRevision, {}, 'reset')
}

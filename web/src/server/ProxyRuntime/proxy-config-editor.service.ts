import '@tanstack/react-start/server-only'

import type { z } from 'zod'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    normalizeProxyHttpSettings,
    proxyConfigEditorSaveSchema,
    proxyConfigEditorResetSchema,
} from '@/features/Admin/ProxyHostManagement/config-validation.ts'
import type {
    ProxyConfigEditorData,
    ProxyHttpSettings,
    ProxyRuntimeMutationStatus,
} from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import {
    getActiveProxyConfiguration,
    previewProxyConfiguration,
} from '@/server/Controller/proxy.server.ts'
import { readProxyRuntimeSnapshot } from './proxy-runtime-data.ts'
import { createProxyRuntimeSnapshot } from './proxy-runtime-snapshot.ts'
import { lockProxyRuntimeSettings, writeProxyHttpSettings } from './proxy-runtime-settings.ts'
import {
    getProxyRuntimeSnapshotService,
    reconcileProxyConfigurationWithAudit,
} from './proxy-runtime.service.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { recordMutationFailureBestEffort } from './audit-mutation.ts'

export class ProxyConfigEditorError extends Error {
    constructor(
        readonly code: 'configuration_conflict' | 'runtime_unavailable' | 'host_not_found',
    ) {
        super(code)
    }
}

export async function getProxyConfigEditorService(): Promise<ProxyConfigEditorData> {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
    const snapshot = await getProxyRuntimeSnapshotService()
    const defaultsSnapshot = createProxyRuntimeSnapshot(
        snapshot.proxyHosts.map((host) => Object.assign({ enabled: true }, host)),
        {},
        snapshot.trustedCas,
        snapshot.redirectHosts.map((host) => Object.assign({ enabled: true }, host)),
        snapshot.defaultSite,
    )
    const [active, defaults] = await Promise.all([
        getActiveProxyConfiguration(),
        previewProxyConfiguration(defaultsSnapshot),
    ])
    return {
        baseRevision: snapshot.revision,
        settings: snapshot.httpSettings ?? {},
        active,
        defaults,
    }
}

async function saveSettings(
    baseRevision: string,
    settings: ProxyHttpSettings,
    action: 'save' | 'reset',
): Promise<ProxyRuntimeMutationStatus> {
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    try {
        await getAuthDatabase().transaction(async (transaction) => {
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
            const latest = await readProxyRuntimeSnapshot(transaction)
            if (latest.revision !== baseRevision) {
                throw new ProxyConfigEditorError('configuration_conflict')
            }
            await writeProxyHttpSettings(transaction, settings)
            await appendAuditEventInTransactionService(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action,
                resource: 'proxy-runtime-settings',
                targetId: null,
                result: 'success',
            })
        })
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action,
            resource: 'proxy-runtime-settings',
            targetId: null,
            error,
        })
        throw error
    }

    return reconcileProxyConfigurationWithAudit(actor.id)
}

export async function saveProxyConfigEditorService(
    input: z.input<typeof proxyConfigEditorSaveSchema>,
): Promise<ProxyRuntimeMutationStatus> {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    const parsed = proxyConfigEditorSaveSchema.parse(input)
    return saveSettings(parsed.baseRevision, normalizeProxyHttpSettings(parsed.settings), 'save')
}

export async function resetProxyConfigEditorService(
    input: z.input<typeof proxyConfigEditorResetSchema>,
): Promise<ProxyRuntimeMutationStatus> {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    const parsed = proxyConfigEditorResetSchema.parse(input)
    return saveSettings(parsed.baseRevision, {}, 'reset')
}

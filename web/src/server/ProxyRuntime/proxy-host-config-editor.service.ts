import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'
import type { z } from 'zod'

import { PERMISSIONS } from '../../config/permissions.config'
import { proxyHosts } from '../../db/schema'
import {
    formatProxyHttpSettings,
    parseProxyHttpSettings,
    proxyHostConfigEditorIdSchema,
    proxyHostConfigEditorSaveSchema,
    proxyHostConfigEditorResetSchema,
    proxyHostConfigEditorPreviewSchema,
} from '../../features/Admin/ProxyHostManagement/config-validation'
import type {
    ProxyHostConfigEditorData,
    ProxyConfigSource,
    ProxyHttpSettings,
    ProxyRuntimeMutationStatus,
} from '../../shared/Types/proxy-runtime.types'
import { requirePermissionService } from '../Auth/Access/authorization.service'
import { requirePermissionInTransaction } from '../Auth/Access/rbac.service'
import { getAuthDatabase, type AuthTransaction } from '../Auth/Core/database.server'
import {
    getActiveProxyHostConfiguration,
    previewProxyHostConfiguration,
} from '../Foundation/controller.server'
import { ProxyConfigEditorError } from './proxy-config-editor.service'
import { readProxyRuntimeHost } from './proxy-runtime-data'
import { createProxyRuntimeSnapshot } from './proxy-runtime-snapshot'
import {
    lockProxyRuntimeSettings,
    readProxyHttpSettings,
    readProxyHostHttpSettings,
    writeProxyHostHttpSettings,
} from './proxy-runtime-settings'
import { reconcileProxyConfigurationService } from './proxy-runtime.service'

async function readHostEditorState(transaction: AuthTransaction, proxyHostId: string) {
    const host = await readProxyRuntimeHost(transaction, proxyHostId)
    if (!host) throw new ProxyConfigEditorError('host_not_found')
    const httpSettings = await readProxyHttpSettings(transaction)
    const hostSettings = await readProxyHostHttpSettings(transaction, host.id)
    const snapshot = createProxyRuntimeSnapshot(
        [{ ...host, enabled: true, httpSettings: hostSettings }],
        httpSettings,
    )
    // Another host's edit must not invalidate this host's draft. Shared defaults do.
    const baseRevision =
        'sha256:' +
        new Bun.CryptoHasher('sha256')
            .update(
                JSON.stringify({ version: 1, enabled: host.enabled, revision: snapshot.revision }),
            )
            .digest('hex')
    return { host, httpSettings, hostSettings, snapshot, baseRevision }
}

async function loadHostEditorState(
    proxyHostId: string,
    actorId: string,
    requiresAdvancedConfig = false,
) {
    return getAuthDatabase().transaction(
        async (transaction) => {
            const actor = await requirePermissionInTransaction(
                transaction,
                actorId,
                PERMISSIONS.PROXY_HOSTS_VIEW,
            )
            if (requiresAdvancedConfig) {
                await requirePermissionInTransaction(
                    transaction,
                    actorId,
                    PERMISSIONS.PROXY_HOSTS_ADVANCED_CONFIG,
                )
            }
            return {
                ...(await readHostEditorState(transaction, proxyHostId)),
                canReadAdvancedConfig: actor.permissions.includes(
                    PERMISSIONS.PROXY_HOSTS_ADVANCED_CONFIG,
                ),
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
    // The structured editor's template is always generated without expert text.
    const defaultsSnapshot = createProxyRuntimeSnapshot(
        [{ ...state.host, enabled: true, advancedConfig: '' }],
        state.httpSettings,
    )
    const generatedSnapshot = state.canReadAdvancedConfig
        ? state.snapshot
        : createProxyRuntimeSnapshot(
              [
                  {
                      ...state.host,
                      enabled: true,
                      httpSettings: state.hostSettings,
                      advancedConfig: '',
                  },
              ],
              state.httpSettings,
          )
    const defaultsRequest = previewProxyHostConfiguration(id, defaultsSnapshot)
    const [active, defaults, generated] = await Promise.all([
        // Never try to redact arbitrary expert syntax from the active file.
        state.canReadAdvancedConfig ? getActiveProxyHostConfiguration(id) : null,
        defaultsRequest,
        generatedSnapshot.revision === defaultsSnapshot.revision
            ? defaultsRequest
            : previewProxyHostConfiguration(id, generatedSnapshot),
    ])
    return {
        proxyHostId: id,
        hostLabel: state.host.domains[0] ?? state.host.forwardHost,
        enabled: state.host.enabled,
        baseRevision: state.baseRevision,
        settingsSource: formatProxyHttpSettings(state.hostSettings),
        commonSettingsSource: formatProxyHttpSettings(state.httpSettings),
        active,
        defaults,
        generated,
        ...(state.canReadAdvancedConfig ? { advancedConfig: state.host.advancedConfig ?? '' } : {}),
    }
}

export async function previewProxyHostConfigEditorService(
    input: z.input<typeof proxyHostConfigEditorPreviewSchema>,
): Promise<ProxyConfigSource> {
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
    const parsed = proxyHostConfigEditorPreviewSchema.parse(input)
    const settings = parseProxyHttpSettings(parsed.settingsSource)
    const state = await loadHostEditorState(
        parsed.proxyHostId,
        actor.id,
        parsed.advancedConfig !== undefined,
    )
    const advancedConfig = state.canReadAdvancedConfig
        ? (parsed.advancedConfig ?? state.host.advancedConfig ?? '')
        : ''
    const snapshot = createProxyRuntimeSnapshot(
        [{ ...state.host, enabled: true, httpSettings: settings, advancedConfig }],
        state.httpSettings,
    )
    const result = await previewProxyHostConfiguration(parsed.proxyHostId, snapshot)
    if (!result) throw new ProxyConfigEditorError('runtime_unavailable')
    return result
}

async function saveHostSettings(
    proxyHostId: string,
    baseRevision: string,
    settings: ProxyHttpSettings,
    advancedConfig?: string,
): Promise<{ readonly enabled: boolean; readonly runtimeStatus: ProxyRuntimeMutationStatus }> {
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    if (advancedConfig !== undefined) {
        await requirePermissionService(PERMISSIONS.PROXY_HOSTS_ADVANCED_CONFIG)
    }
    const enabled = await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(transaction, actor.id, PERMISSIONS.PROXY_HOSTS_UPDATE)
        await requirePermissionInTransaction(transaction, actor.id, PERMISSIONS.PROXY_HOSTS_APPLY)
        if (advancedConfig !== undefined) {
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.PROXY_HOSTS_ADVANCED_CONFIG,
            )
        }
        const latest = await readHostEditorState(transaction, proxyHostId)
        if (latest.baseRevision !== baseRevision)
            throw new ProxyConfigEditorError('configuration_conflict')
        await writeProxyHostHttpSettings(transaction, proxyHostId, settings)
        // Ordinary/structured edits never write the protected field.
        if (advancedConfig !== undefined) {
            await transaction
                .update(proxyHosts)
                .set({ advancedConfig, updatedAt: new Date() })
                .where(eq(proxyHosts.id, proxyHostId))
        }
        return latest.host.enabled
    })
    return { enabled, runtimeStatus: await reconcileProxyConfigurationService() }
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
        parseProxyHttpSettings(parsed.settingsSource),
        parsed.advancedConfig,
    )
}

export async function resetProxyHostConfigEditorService(
    input: z.input<typeof proxyHostConfigEditorResetSchema>,
) {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    const parsed = proxyHostConfigEditorResetSchema.parse(input)
    return saveHostSettings(
        parsed.proxyHostId,
        parsed.baseRevision,
        {},
        parsed.resetAdvancedConfig ? '' : undefined,
    )
}

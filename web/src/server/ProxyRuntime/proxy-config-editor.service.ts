import '@tanstack/react-start/server-only'

import type { z } from 'zod'

import { PERMISSIONS } from '../../config/permissions.config'
import {
    formatProxyHttpSettings,
    parseProxyHttpSettings,
    proxyConfigEditorSaveSchema,
    proxyConfigEditorResetSchema,
} from '../../features/Admin/ProxyHostManagement/config-validation'
import type {
    ProxyConfigEditorData,
    ProxyConfigSource,
    ProxyHttpSettings,
    ProxyRuntimeMutationStatus,
} from '../../shared/Types/proxy-runtime.types'
import { requirePermissionService } from '../Auth/Access/authorization.service'
import { requirePermissionInTransaction } from '../Auth/Access/rbac.service'
import { getAuthDatabase } from '../Auth/Core/database.server'
import {
    getActiveProxyConfiguration,
    previewProxyConfiguration,
} from '../Foundation/controller.server'
import { readProxyRuntimeSnapshot } from './proxy-runtime-data'
import { createProxyRuntimeSnapshot } from './proxy-runtime-snapshot'
import { lockProxyRuntimeSettings, writeProxyHttpSettings } from './proxy-runtime-settings'
import {
    getProxyRuntimeSnapshotService,
    reconcileProxyConfigurationService,
} from './proxy-runtime.service'

export class ProxyConfigEditorError extends Error {
    constructor(
        readonly code: 'configuration_conflict' | 'runtime_unavailable' | 'host_not_found',
    ) {
        super(code)
    }
}

export async function getProxyConfigEditorService(): Promise<ProxyConfigEditorData> {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
    // Full config sources may include expert text from any host.
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_ADVANCED_CONFIG)
    const snapshot = await getProxyRuntimeSnapshotService()
    const defaultsSnapshot = createProxyRuntimeSnapshot(
        snapshot.proxyHosts.map((host) => Object.assign({ enabled: true }, host)),
    )
    const [active, defaults] = await Promise.all([
        getActiveProxyConfiguration(),
        previewProxyConfiguration(defaultsSnapshot),
    ])
    return {
        baseRevision: snapshot.revision,
        settingsSource: formatProxyHttpSettings(snapshot.httpSettings ?? {}),
        active,
        defaults,
    }
}

export async function previewProxyConfigEditorService(source: string): Promise<ProxyConfigSource> {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
    // Full config sources may include expert text from any host.
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_ADVANCED_CONFIG)
    const settings = parseProxyHttpSettings(source)
    const snapshot = await getProxyRuntimeSnapshotService()
    const candidate = createProxyRuntimeSnapshot(
        snapshot.proxyHosts.map((host) => Object.assign({ enabled: true }, host)),
        settings,
    )
    const preview = await previewProxyConfiguration(candidate)
    if (!preview) throw new ProxyConfigEditorError('runtime_unavailable')
    return preview
}

async function saveSettings(
    baseRevision: string,
    settings: ProxyHttpSettings,
): Promise<ProxyRuntimeMutationStatus> {
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(transaction, actor.id, PERMISSIONS.PROXY_HOSTS_UPDATE)
        await requirePermissionInTransaction(transaction, actor.id, PERMISSIONS.PROXY_HOSTS_APPLY)
        const latest = await readProxyRuntimeSnapshot(transaction)
        if (latest.revision !== baseRevision) {
            throw new ProxyConfigEditorError('configuration_conflict')
        }
        await writeProxyHttpSettings(transaction, settings)
    })
    // The database commit stays durable if the runtime cannot currently apply it.
    return reconcileProxyConfigurationService()
}

export async function saveProxyConfigEditorService(
    input: z.input<typeof proxyConfigEditorSaveSchema>,
): Promise<ProxyRuntimeMutationStatus> {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    const parsed = proxyConfigEditorSaveSchema.parse(input)
    return saveSettings(parsed.baseRevision, parseProxyHttpSettings(parsed.settingsSource))
}

export async function resetProxyConfigEditorService(
    input: z.input<typeof proxyConfigEditorResetSchema>,
): Promise<ProxyRuntimeMutationStatus> {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    const parsed = proxyConfigEditorResetSchema.parse(input)
    return saveSettings(parsed.baseRevision, {})
}

import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '../../config/permissions.config'
import type { ProxyRuntimeSyncStatus } from '../../shared/Types/proxy-runtime.types'
import { requirePermissionService } from '../Auth/Access/authorization.service'
import { getAuthDatabase } from '../Auth/Core/database.server'
import {
    applyProxyRuntimeConfiguration,
    getProxyRuntimeStatus,
} from '../Foundation/controller.server'
import { createProxyReconciler } from './proxy-reconcile'
import { compareProxyRuntimeStatus } from './proxy-runtime-snapshot'
import { readProxyRuntimeSnapshot } from './proxy-runtime-data'
import type { ProxyRuntimeSnapshot } from './Types/proxy-runtime.types'

export async function getProxyRuntimeSnapshotService(): Promise<ProxyRuntimeSnapshot> {
    // Hosts, domains and HTTP settings must come from the same committed snapshot.
    return getAuthDatabase().transaction((transaction) => readProxyRuntimeSnapshot(transaction), {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
    })
}

export const reconcileProxyConfigurationService = createProxyReconciler({
    loadSnapshot: getProxyRuntimeSnapshotService,
    applySnapshot: applyProxyRuntimeConfiguration,
})

export async function getProxyRuntimeStatusService(): Promise<ProxyRuntimeSyncStatus> {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
    const [snapshot, runtime] = await Promise.all([
        getProxyRuntimeSnapshotService(),
        getProxyRuntimeStatus(),
    ])

    return compareProxyRuntimeStatus(snapshot.revision, runtime)
}

export async function applyProxyConfigurationService() {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    return reconcileProxyConfigurationService()
}

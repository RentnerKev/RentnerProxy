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
    checkDrift: async () => {
        const [snapshot, runtime] = await Promise.all([
            getProxyRuntimeSnapshotService(),
            getProxyRuntimeStatus(),
        ])
        return compareProxyRuntimeStatus(snapshot.revision, runtime).state !== 'synced'
    },
})

export function startProxyRuntimeReconciliation(): void {
    reconcileProxyConfigurationService.start()
}

export function stopProxyRuntimeReconciliation(): Promise<void> {
    return reconcileProxyConfigurationService.stop()
}

type RuntimeViewPermission =
    | typeof PERMISSIONS.PROXY_HOSTS_VIEW
    | typeof PERMISSIONS.REDIRECT_HOSTS_VIEW
type RuntimeApplyPermission =
    | typeof PERMISSIONS.PROXY_HOSTS_APPLY
    | typeof PERMISSIONS.REDIRECT_HOSTS_APPLY

export async function getProxyRuntimeStatusService(
    permission: RuntimeViewPermission = PERMISSIONS.PROXY_HOSTS_VIEW,
): Promise<ProxyRuntimeSyncStatus> {
    await requirePermissionService(permission)
    const [snapshot, runtime] = await Promise.all([
        getProxyRuntimeSnapshotService(),
        getProxyRuntimeStatus(),
    ])

    return compareProxyRuntimeStatus(snapshot.revision, runtime)
}

export async function applyProxyConfigurationService(
    permission: RuntimeApplyPermission = PERMISSIONS.PROXY_HOSTS_APPLY,
) {
    await requirePermissionService(permission)
    return reconcileProxyConfigurationService()
}

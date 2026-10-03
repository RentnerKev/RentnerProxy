import type { RuntimeViewPermission, RuntimeApplyPermission } from './Types/proxy-runtime.types.ts'
import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import type {
    ProxyRuntimeMutationStatus,
    ProxyRuntimeSyncStatus,
} from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import {
    applyProxyRuntimeConfiguration,
    getProxyRuntimeStatus,
} from '@/server/Controller/proxy.server.ts'
import { createProxyReconciler } from './proxy-reconcile.ts'
import { compareProxyRuntimeStatus } from './proxy-runtime-snapshot.ts'
import { readProxyRuntimeSnapshot } from './proxy-runtime-data.ts'
import type { ProxyRuntimeSnapshot } from './Types/proxy-runtime.types.ts'
import { recordAuditEventBestEffortService } from '@/server/Audit/audit.service.ts'

export async function getProxyRuntimeSnapshotService(): Promise<ProxyRuntimeSnapshot> {
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

export function getRedirectRuntimeStatusService(): Promise<ProxyRuntimeSyncStatus> {
    return getProxyRuntimeStatusService(PERMISSIONS.REDIRECT_HOSTS_VIEW)
}

export async function applyProxyConfigurationService(
    permission: RuntimeApplyPermission = PERMISSIONS.PROXY_HOSTS_APPLY,
) {
    const actor = await requirePermissionService(permission)
    return reconcileProxyConfigurationWithAudit(actor.id)
}

export function applyRedirectConfigurationService(): Promise<ProxyRuntimeMutationStatus> {
    return applyProxyConfigurationService(PERMISSIONS.REDIRECT_HOSTS_APPLY)
}

export async function reconcileProxyConfigurationWithAudit(
    actorId: string,
): Promise<ProxyRuntimeMutationStatus> {
    try {
        const status = await reconcileProxyConfigurationService()
        await recordAuditEventBestEffortService({
            actorUserId: actorId,
            actorKind: 'user',
            action: 'apply',
            resource: 'proxy-runtime',
            targetId: null,
            result: 'success',
            metadata: { runtimeStatus: status },
        })
        return status
    } catch (error) {
        await recordAuditEventBestEffortService({
            actorUserId: actorId,
            actorKind: 'user',
            action: 'apply',
            resource: 'proxy-runtime',
            targetId: null,
            result: 'failure',
            metadata: { runtimeStatus: 'failed', failureCode: 'runtime_failed' },
        })
        throw error
    }
}

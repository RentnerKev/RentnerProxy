import type { PermissionKey } from '@/shared/Types/permissions-config.types.ts'
import type { ProxyRuntimeSyncStatus } from '@/shared/Types/proxy-runtime.types.ts'

export interface AccessPolicyManagementPageProps {
    readonly permissions: readonly PermissionKey[]
}

export type AccessPolicyRuntimeStatus = ProxyRuntimeSyncStatus
export type AccessPolicyRuntimeState = AccessPolicyRuntimeStatus['state']

import type { PermissionKey } from '../../../../config/permissions.config'
import type { ProxyRuntimeSyncStatus } from '../../../../shared/Types/proxy-runtime.types'
import type useAccessPolicyManagementLogic from '../Hooks/useAccessPolicyManagementLogic'

export interface AccessPolicyManagementPageProps {
    readonly permissions: readonly PermissionKey[]
}

export interface AccessPolicyManagementPageViewProps {
    readonly logic: ReturnType<typeof useAccessPolicyManagementLogic>
}

export type AccessPolicyRuntimeStatus = ProxyRuntimeSyncStatus
export type AccessPolicyRuntimeState = AccessPolicyRuntimeStatus['state']

import type { PermissionKey } from '../../../../config/permissions.config'
import type { ProxyRuntimeSyncStatus } from '../../../../shared/Types/proxy-runtime.types'
import type useRedirectHostManagementLogic from '../Hooks/useRedirectHostManagementLogic'

export interface RedirectHostManagementPageProps {
    readonly permissions: readonly PermissionKey[]
}
export interface RedirectHostManagementPageViewProps {
    readonly logic: ReturnType<typeof useRedirectHostManagementLogic>
}
export type RedirectRuntimeStatus = ProxyRuntimeSyncStatus

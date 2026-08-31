import type { PermissionKey } from '../../../../config/permissions.config'
import type { ProxyRuntimeSyncStatus } from '../../../../shared/Types/proxy-runtime.types'
import type useProxyHostManagementLogic from '../Hooks/useProxyHostManagementLogic'

export interface ProxyHostManagementPageProps {
    readonly permissions: readonly PermissionKey[]
}

export interface ProxyHostManagementPageViewProps {
    readonly logic: ReturnType<typeof useProxyHostManagementLogic>
}

export type ProxyRuntimeStatus = ProxyRuntimeSyncStatus
export type ProxyRuntimeState = ProxyRuntimeStatus['state']

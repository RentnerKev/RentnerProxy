import type { PermissionKey } from '../../../../config/permissions.config'
import type useProxyHostManagementLogic from '../Hooks/useProxyHostManagementLogic'

export interface ProxyHostManagementPageProps {
    readonly permissions: readonly PermissionKey[]
}

export interface ProxyHostManagementPageViewProps {
    readonly logic: ReturnType<typeof useProxyHostManagementLogic>
}

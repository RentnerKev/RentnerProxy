import type { PermissionKey } from '@/shared/Types/permissions-config.types.ts'
import type { ProxyRuntimeSyncStatus } from '@/shared/Types/proxy-runtime.types.ts'

export interface ProxyHostManagementPageProps {
    readonly permissions: readonly PermissionKey[]
}

export type ProxyRuntimeStatus = ProxyRuntimeSyncStatus
export type ProxyRuntimeState = ProxyRuntimeStatus['state']

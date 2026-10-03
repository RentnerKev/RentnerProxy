import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { ProxyRuntimeSyncStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export interface ProxyHostManagementPageProps {
    readonly permissions: readonly PermissionKey[]
}

export type ProxyRuntimeStatus = ProxyRuntimeSyncStatus
export type ProxyRuntimeState = ProxyRuntimeStatus['state']

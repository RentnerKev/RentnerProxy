import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { ProxyRuntimeSyncStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export interface RedirectHostManagementPageProps {
    readonly permissions: readonly PermissionKey[]
}
export type RedirectRuntimeStatus = ProxyRuntimeSyncStatus

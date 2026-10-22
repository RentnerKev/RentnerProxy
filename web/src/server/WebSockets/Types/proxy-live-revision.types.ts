import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { ProxyRuntimeStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export type ProxyLiveTopic = 'proxy-hosts' | 'redirect-hosts' | 'access-policies'

export interface ProxyLiveRevisionDependencies {
    authorize: (permission: PermissionKey) => Promise<unknown>
    readDigest: (topic: ProxyLiveTopic) => Promise<string>
    readRuntime: () => Promise<ProxyRuntimeStatus | null>
}

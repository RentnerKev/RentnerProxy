import type { CreateProxyHostInput } from '../../../../web/src/features/Admin/ProxyHostManagement/Types/validation.types.ts'
import type { ProxyHostSummary } from '../../../../web/src/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { ProxyRuntimeStatus } from '../../../../web/src/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import type { ProxyHostUpstreamHealth } from '../../../../web/src/lib/ProxyRuntime/Types/upstream-health.types.ts'
import type { ProxyRuntimeSnapshot } from '../../../../web/src/server/ProxyRuntime/Types/proxy-runtime.types.ts'

export interface UpstreamFailoverSmokeOptions {
    readonly forwardHost: string
    readonly createHost: (input: CreateProxyHostInput) => Promise<{
        readonly id: string
        readonly runtimeStatus: string
    }>
    readonly deleteHost: (id: string) => Promise<unknown>
    readonly readHosts: () => Promise<readonly ProxyHostSummary[]>
    readonly readSnapshot: () => Promise<ProxyRuntimeSnapshot>
    readonly readRuntimeStatus: () => Promise<ProxyRuntimeStatus | null>
    readonly readHealth: (id: string) => Promise<ProxyHostUpstreamHealth>
    readonly request: (domain: string, init?: RequestInit) => Promise<Response>
    readonly stopRuntime: () => Promise<void>
    readonly startRuntime: () => Promise<void>
    readonly passed: (label: string) => void
}

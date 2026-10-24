import type { ProxyRuntimeSyncStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export interface ForwardAuthSummary {
    readonly policyCount: number
    readonly assignedHosts: number
    readonly runtimeState: ProxyRuntimeSyncStatus['state']
}

import type { ProxyHostUpstreamHealth } from '@/lib/ProxyRuntime/Types/upstream-health.types.ts'
import type { ProxyUpstreamMember } from '@/lib/ProxyRuntime/Types/upstream-pool.types.ts'
export interface UpstreamHealthDesiredState {
    readonly hostId: string
    readonly enabled: boolean
    readonly hasPool: boolean
    readonly revision: string
    readonly members: readonly ProxyUpstreamMember[]
}
export interface UpstreamHealthReaderDependencies {
    readonly authorize: () => Promise<string>
    readonly readDesired: (hostId: string, actorId: string) => Promise<UpstreamHealthDesiredState>
    readonly readHealth: (hostId: string) => Promise<ProxyHostUpstreamHealth | null>
    readonly now: () => number
}

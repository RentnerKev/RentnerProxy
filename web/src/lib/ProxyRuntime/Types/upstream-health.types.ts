export type ProxyUpstreamMemberHealthState = 'available' | 'unavailable' | 'unknown'
export interface ProxyHostUpstreamHealth {
    readonly hostId: string
    readonly revision: string | null
    readonly observedAt: string | null
    readonly state: 'available' | 'all_unavailable' | 'unknown'
    readonly members: readonly {
        readonly index: number
        readonly host: string
        readonly port: number
        readonly state: ProxyUpstreamMemberHealthState
    }[]
}

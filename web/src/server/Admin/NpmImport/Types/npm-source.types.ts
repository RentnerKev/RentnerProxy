export type NpmRecord = Record<string, unknown>

export interface NpmSource {
    readonly schema: 'npm-2.16-schema'
    readonly proxyHosts: readonly NpmRecord[]
    readonly redirectHosts: readonly NpmRecord[]
    readonly accessLists: readonly NpmRecord[]
    readonly accessClients: readonly NpmRecord[]
    readonly authCounts: readonly NpmRecord[]
    readonly certificates: readonly NpmRecord[]
    readonly deadHosts: readonly NpmRecord[]
    readonly streams: readonly NpmRecord[]
}

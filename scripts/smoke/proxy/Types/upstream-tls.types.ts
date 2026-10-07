export type JsonObject = Record<string, any>

type UpstreamTls = {
    readonly verify: boolean
    readonly serverName: string | null
    readonly trustedCaId: string | null
}

export type ProxyHost = {
    readonly id: string
    readonly domains: readonly string[]
    readonly forwardScheme: 'http' | 'https'
    readonly forwardHost: string
    readonly forwardPort: number
    readonly upstreamTls?: UpstreamTls
}

export type TrustedCa = {
    readonly id: string
    readonly pem: string
    readonly fingerprintSha256: string
}

export type Snapshot = {
    readonly version: 7
    readonly revision: string
    readonly proxyHosts: readonly ProxyHost[]
    readonly redirectHosts: readonly unknown[]
    readonly httpSettings: Record<string, never>
    readonly trustedCas: readonly TrustedCa[]
}

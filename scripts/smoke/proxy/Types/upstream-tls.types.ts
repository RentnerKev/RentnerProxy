import type { ProxyUpstreamPool } from '../../../../web/src/lib/ProxyRuntime/Types/upstream-pool.types.ts'
import type { ProxyHostAccessPolicy } from '../../../../web/src/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
export type JsonObject = Record<string, unknown>

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
    readonly accessPolicy?: ProxyHostAccessPolicy
    readonly upstreamPool?: ProxyUpstreamPool
}

export type TrustedCa = {
    readonly id: string
    readonly pem: string
    readonly fingerprintSha256: string
}

export type Snapshot = {
    readonly version: 7 | 8
    readonly revision: string
    readonly proxyHosts: readonly ProxyHost[]
    readonly redirectHosts: readonly unknown[]
    readonly httpSettings: Record<string, never>
    readonly trustedCas: readonly TrustedCa[]
}

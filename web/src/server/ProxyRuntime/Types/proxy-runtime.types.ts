import type { ProxyHostForwardScheme } from '../../../config/proxy-hosts.config'
import type { RedirectHostStatusCode } from '../../../config/redirect-hosts.config'
import type { ProxyHttpSettings } from '../../../shared/Types/proxy-runtime.types'

export interface ProxyRuntimeHost {
    readonly id: string
    readonly domains: ReadonlyArray<string>
    readonly forwardScheme: ProxyHostForwardScheme
    readonly forwardHost: string
    readonly forwardPort: number
    readonly httpSettings?: ProxyHttpSettings
    readonly advancedConfig?: string
    readonly certificateId?: string | null
    readonly forceHttps?: boolean
    readonly upstreamTls?: ProxyRuntimeUpstreamTls
}

export interface ProxyRuntimeUpstreamTls {
    readonly verify: boolean
    readonly serverName: string | null
    readonly trustedCaId: string | null
}

export interface ProxyRuntimeTrustedCa {
    readonly id: string
    readonly pem: string
    readonly fingerprintSha256: string
}

export interface RedirectRuntimeHost {
    readonly id: string
    readonly domains: ReadonlyArray<string>
    readonly destination: string
    readonly statusCode: RedirectHostStatusCode
    readonly preserveRequestUri: boolean
    readonly certificateId?: string | null
}

export interface ProxyRuntimeSnapshot {
    readonly version: 1 | 2 | 3 | 4 | 5 | 6
    readonly revision: string
    readonly proxyHosts: ReadonlyArray<ProxyRuntimeHost>
    readonly redirectHosts?: ReadonlyArray<RedirectRuntimeHost>
    readonly httpSettings?: ProxyHttpSettings
    readonly trustedCas?: ReadonlyArray<ProxyRuntimeTrustedCa>
}

export interface ProxyRuntimeApplyResponse {
    readonly status: 'applied' | 'unchanged'
    readonly activeRevision: string
    readonly lastApplyAt: string | null
}

import type { ProxyHostForwardScheme } from '../../../config/proxy-hosts.config'

export interface ProxyRuntimeHost {
    readonly id: string
    readonly domains: ReadonlyArray<string>
    readonly forwardScheme: ProxyHostForwardScheme
    readonly forwardHost: string
    readonly forwardPort: number
}

export interface ProxyRuntimeSnapshot {
    readonly version: 1
    readonly revision: string
    readonly proxyHosts: ReadonlyArray<ProxyRuntimeHost>
}

export interface ProxyRuntimeApplyResponse {
    readonly status: 'applied' | 'unchanged'
    readonly activeRevision: string
    readonly lastApplyAt: string | null
}

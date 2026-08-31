import type { ProxyHostForwardScheme } from '../../../config/proxy-hosts.config'
import type { ProxyHttpSettings } from '../../../shared/Types/proxy-runtime.types'

export interface ProxyRuntimeHost {
    readonly id: string
    readonly domains: ReadonlyArray<string>
    readonly forwardScheme: ProxyHostForwardScheme
    readonly forwardHost: string
    readonly forwardPort: number
    readonly httpSettings?: ProxyHttpSettings
    readonly advancedConfig?: string
}

export interface ProxyRuntimeSnapshot {
    readonly version: 1 | 2 | 3
    readonly revision: string
    readonly proxyHosts: ReadonlyArray<ProxyRuntimeHost>
    readonly httpSettings?: ProxyHttpSettings
}

export interface ProxyRuntimeApplyResponse {
    readonly status: 'applied' | 'unchanged'
    readonly activeRevision: string
    readonly lastApplyAt: string | null
}

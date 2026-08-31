import type { ProxyHostForwardScheme } from '../../config/proxy-hosts.config'

export interface ProxyHostSummary {
    readonly id: string
    readonly domains: Array<string>
    readonly forwardScheme: ProxyHostForwardScheme
    readonly forwardHost: string
    readonly forwardPort: number
    readonly enabled: boolean
    readonly certificateId: string | null
    readonly forceHttps: boolean
    readonly createdAt: Date
    readonly updatedAt: Date
}

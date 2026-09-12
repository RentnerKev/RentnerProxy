import type { ProxyHostForwardScheme } from '../../config/proxy-hosts.config'
import type { AccessPolicyCombination, AccessPolicyMode } from '../../config/access-policies.config'
import type { AccessPolicyBasicAuthRuntime, AccessPolicyIpRules } from './access-policies.types'
import type { CertificateJobSummary } from './certificate-jobs.types'

export interface ProxyHostAccessPolicy {
    readonly id: string
    readonly mode: AccessPolicyMode
    readonly combination: AccessPolicyCombination | null
    readonly basicAuth?: AccessPolicyBasicAuthRuntime | undefined
    readonly ipRules?: AccessPolicyIpRules | undefined
}

export interface ProxyHostSummary {
    readonly certificateJob?: CertificateJobSummary | null
    readonly id: string
    readonly domains: Array<string>
    readonly forwardScheme: ProxyHostForwardScheme
    readonly forwardHost: string
    readonly forwardPort: number
    readonly enabled: boolean
    readonly certificateId: string | null
    readonly forceHttps: boolean
    readonly verifyUpstreamTls: boolean
    readonly upstreamTlsServerName: string | null
    readonly trustedCaId: string | null
    readonly accessPolicyId?: string | null
    readonly createdAt: Date
    readonly updatedAt: Date
}

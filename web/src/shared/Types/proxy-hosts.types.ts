import type { ProxyHostForwardScheme } from './proxy-hosts-config.types.ts'
import type { AccessPolicyCombination, AccessPolicyMode } from './access-policies-config.types.ts'
import type { AccessPolicyBasicAuthRuntime, AccessPolicyIpRules } from './access-policies.types.ts'
import type { ForwardAuthRuntimeConfiguration } from '@/lib/ForwardAuth/forwardAuth.ts'
import type { CertificateJobSummary } from './certificate-jobs.types.ts'

export interface ProxyHostAccessPolicy {
    readonly id: string
    readonly mode: AccessPolicyMode
    readonly combination: AccessPolicyCombination | null
    readonly basicAuth?: AccessPolicyBasicAuthRuntime | undefined
    readonly ipRules?: AccessPolicyIpRules | undefined
    readonly forwardAuth?: ForwardAuthRuntimeConfiguration | undefined
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

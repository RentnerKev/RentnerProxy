import type { BrowserCacheSettings } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import type { ResponseCacheSettings } from '@/lib/ResponseCache/Types/response-cache.types.ts'
import type { ProxyHostForwardScheme } from '../../../../config/Types/proxy-hosts-config.types.ts'
import type {
    AccessPolicyCombination,
    AccessPolicyMode,
} from '../../../../config/Types/access-policies-config.types.ts'
import type { AccessPolicyBasicAuthRuntime } from '../../../AccessPolicies/Types/access-policies.types.ts'
import type { AccessPolicyIpRules } from '../../../AccessPolicies/Types/ip-access-rules.types.ts'
import type { ForwardAuthRuntimeConfiguration } from '@/lib/ForwardAuth/Types/forward-auth.types.ts'
import type { CertificateJobSummary } from '../../../CertificateJobs/Types/certificate-jobs.types.ts'
import type { HostTag } from '@/lib/HostTags/Types/host-tags.types.ts'

export interface ProxyHostAccessPolicy {
    readonly id: string
    readonly mode: AccessPolicyMode
    readonly combination: AccessPolicyCombination | null
    readonly basicAuth?: AccessPolicyBasicAuthRuntime | undefined
    readonly ipRules?: AccessPolicyIpRules | undefined
    readonly forwardAuth?: ForwardAuthRuntimeConfiguration | undefined
}

export interface ProxyHostSummary {
    readonly responseCompression?: 'auto' | 'off' | null | undefined
    readonly browserCache?: BrowserCacheSettings | undefined
    readonly responseCache?: ResponseCacheSettings | null | undefined
    readonly tags?: readonly HostTag[]
    readonly discovery?: { readonly state: 'managed' | 'orphaned' } | null
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

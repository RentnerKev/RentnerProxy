import type { AccessPolicyMode } from '../../../../config/access-policies.config'
import type { AccessPolicySummary } from '../../../../shared/Types/access-policies.types'
import type { BasicAuthStatus } from '../Types/basic-auth.types'

export function getBasicAuthAccountCount(policy: AccessPolicySummary): number {
    return policy.basicAuthAccountCount
}

export function getBasicAuthStatus(
    mode: AccessPolicyMode,
    combination: AccessPolicySummary['combination'],
    count: number,
): BasicAuthStatus {
    if (mode === 'public') return 'publicIgnored'
    if (mode === 'ip-restricted' || (mode === 'combined' && combination === 'all')) {
        return 'ipProviderRequired'
    }
    if (count > 0) return mode === 'combined' ? 'combinedAnyAvailable' : 'available'
    return 'combinedAnyMissing'
}

import type { AccessPolicyMode } from '../../../../config/access-policies.config'
import type {
    AccessPolicyIpRules,
    AccessPolicySummary,
} from '../../../../shared/Types/access-policies.types'
import type { BasicAuthStatus } from '../Types/basic-auth.types'

export type AccessPolicyAvailabilityStatus =
    | 'publicIgnored'
    | 'authenticatedAvailable'
    | 'authenticatedMissing'
    | 'ipRestrictedAvailable'
    | 'ipRestrictedMissing'
    | 'ipRestrictedBlocksAll'
    | 'combinedAllAvailable'
    | 'combinedAllMissingAuth'
    | 'combinedAllMissingIp'
    | 'combinedAllMissingBoth'
    | 'combinedAllIpBlocksAll'
    | 'combinedAnyAvailableAuth'
    | 'combinedAnyAvailableIp'
    | 'combinedAnyAvailableBoth'
    | 'combinedAnyIpBlocksAll'
    | 'combinedAnyMissing'

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

export function getAccessPolicyAvailability(
    mode: AccessPolicyMode,
    combination: AccessPolicySummary['combination'],
    basicAuthAccountCount: number,
    ipRules: AccessPolicyIpRules | null,
): AccessPolicyAvailabilityStatus {
    const hasBasicAuth = basicAuthAccountCount > 0
    const hasIpRules = ipRules !== null
    const ipCanAllow =
        ipRules !== null && (ipRules.defaultAction === 'allow' || ipRules.allow.length > 0)

    if (mode === 'public') return 'publicIgnored'
    if (mode === 'authenticated') {
        return hasBasicAuth ? 'authenticatedAvailable' : 'authenticatedMissing'
    }
    if (mode === 'ip-restricted') {
        if (!hasIpRules) return 'ipRestrictedMissing'
        return ipCanAllow ? 'ipRestrictedAvailable' : 'ipRestrictedBlocksAll'
    }

    if (combination === 'all') {
        if (hasBasicAuth && ipCanAllow) return 'combinedAllAvailable'
        if (!hasBasicAuth && !hasIpRules) return 'combinedAllMissingBoth'
        if (hasBasicAuth && hasIpRules && !ipCanAllow) return 'combinedAllIpBlocksAll'
        return hasBasicAuth ? 'combinedAllMissingIp' : 'combinedAllMissingAuth'
    }

    if (hasBasicAuth && ipCanAllow) return 'combinedAnyAvailableBoth'
    if (hasBasicAuth) return 'combinedAnyAvailableAuth'
    if (ipCanAllow) return 'combinedAnyAvailableIp'
    if (hasIpRules) return 'combinedAnyIpBlocksAll'
    return 'combinedAnyMissing'
}

export function getIpAccessStatus(
    mode: AccessPolicyMode,
    ipRules: AccessPolicyIpRules | null,
): 'ignored' | 'enabled' | 'missing' {
    if (mode === 'public' || mode === 'authenticated') return 'ignored'
    return ipRules === null ? 'missing' : 'enabled'
}

export function getIpAccessRuleCount(ipRules: AccessPolicyIpRules | null): number {
    return ipRules ? ipRules.allow.length + ipRules.deny.length : 0
}

import type { AccessPolicyCombination, AccessPolicyMode } from '../../config/access-policies.config'
import type { AccessPolicyIpRules } from '../Helpers/ipAccessRules'

export type { AccessPolicyIpRuleAction, AccessPolicyIpRules } from '../Helpers/ipAccessRules'

export interface AccessPolicyBasicAuthRuntimeAccount {
    readonly username: string
    readonly passwordHash: string
}

export interface AccessPolicyBasicAuthRuntime {
    readonly accounts: ReadonlyArray<AccessPolicyBasicAuthRuntimeAccount>
}

export interface AccessPolicySummary {
    readonly id: string
    readonly name: string
    readonly description: string
    readonly mode: AccessPolicyMode
    readonly combination: AccessPolicyCombination | null
    readonly ipRules: AccessPolicyIpRules | null
    readonly assignedHostCount: number
    readonly basicAuthAccountCount: number
    readonly createdAt: Date
    readonly updatedAt: Date
}

import type { AccessPolicyCombination, AccessPolicyMode } from './access-policies-config.types.ts'
import type { AccessPolicyIpRules } from '@/lib/AccessPolicies/ipAccessRules.ts'
import type { ForwardAuthConfiguration } from '@/lib/ForwardAuth/forwardAuth.ts'

export type {
    AccessPolicyIpRuleAction,
    AccessPolicyIpRules,
} from '@/lib/AccessPolicies/ipAccessRules.ts'

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
    readonly forwardAuth: ForwardAuthConfiguration | null
    readonly assignedHostCount: number
    readonly basicAuthAccountCount: number
    readonly createdAt: Date
    readonly updatedAt: Date
}

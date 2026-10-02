import type {
    AccessPolicyIpRuleAction,
    AccessPolicyIpRules,
} from '@/shared/Types/access-policies.types.ts'

export interface AccessPolicyIpRulesDraft {
    readonly defaultAction: AccessPolicyIpRuleAction
    readonly allow: string
    readonly deny: string
}

export interface AccessPolicyIpRulesParseSuccess {
    readonly rules: AccessPolicyIpRules | null
}

export interface AccessPolicyIpRulesParseFailure {
    readonly error:
        | 'admin.accessPolicies.validation.ipRulesInvalid'
        | 'admin.accessPolicies.validation.ipRulesTooMany'
    readonly rules: null
}

export type AccessPolicyIpRulesParseResult =
    | AccessPolicyIpRulesParseSuccess
    | AccessPolicyIpRulesParseFailure

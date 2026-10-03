import type {
    AccessPolicyIpRuleAction,
    AccessPolicyIpRules,
} from '@/lib/AccessPolicies/Types/ip-access-rules.types.ts'

export interface AccessPolicyIpRulesDraft {
    readonly defaultAction: AccessPolicyIpRuleAction
    readonly allow: string
    readonly deny: string
}

interface AccessPolicyIpRulesParseSuccess {
    readonly rules: AccessPolicyIpRules | null
}

interface AccessPolicyIpRulesParseFailure {
    readonly error:
        | 'admin.accessPolicies.validation.ipRulesInvalid'
        | 'admin.accessPolicies.validation.ipRulesTooMany'
    readonly rules: null
}

export type AccessPolicyIpRulesParseResult =
    | AccessPolicyIpRulesParseSuccess
    | AccessPolicyIpRulesParseFailure

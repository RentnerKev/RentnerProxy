import { MAX_ACCESS_POLICY_IP_RULES } from '../../../../config/access-policies.config'
import { accessPolicyIpRulesInputSchema } from '../../../../shared/Helpers/ipAccessRules'
import type { AccessPolicyIpRuleAction } from '../../../../shared/Helpers/ipAccessRules'
import type { AccessPolicyIpRules } from '../../../../shared/Types/access-policies.types'

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

export const defaultAccessPolicyIpRules: AccessPolicyIpRulesDraft = {
    defaultAction: 'deny',
    allow: '',
    deny: '',
}

export function accessPolicyIpRulesToDraft(
    rules: AccessPolicyIpRules | null | undefined,
): AccessPolicyIpRulesDraft | null {
    if (!rules) return null
    return {
        defaultAction: rules.defaultAction,
        allow: rules.allow.join('\n'),
        deny: rules.deny.join('\n'),
    }
}

export function splitIpRuleLines(value: string): string[] {
    return value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
}

export function parseAccessPolicyIpRulesDraft(
    draft: AccessPolicyIpRulesDraft | null,
): AccessPolicyIpRulesParseResult {
    if (!draft) return { rules: null }

    const allow = splitIpRuleLines(draft.allow)
    const deny = splitIpRuleLines(draft.deny)
    if (allow.length > MAX_ACCESS_POLICY_IP_RULES || deny.length > MAX_ACCESS_POLICY_IP_RULES) {
        return {
            error: 'admin.accessPolicies.validation.ipRulesTooMany',
            rules: null,
        }
    }

    const parsed = accessPolicyIpRulesInputSchema.safeParse({
        defaultAction: draft.defaultAction,
        allow,
        deny,
    })
    return parsed.success
        ? { rules: parsed.data }
        : { error: 'admin.accessPolicies.validation.ipRulesInvalid', rules: null }
}

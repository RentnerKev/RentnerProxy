import { MAX_ACCESS_POLICY_IP_RULES } from '@/config/access-policies.config.ts'
import { accessPolicyIpRulesInputSchema } from '@/lib/AccessPolicies/ipAccessRules.ts'
import type { AccessPolicyIpRules } from '@/shared/Types/access-policies.types.ts'

import type {
    AccessPolicyIpRulesDraft,
    AccessPolicyIpRulesParseResult,
} from './Types/ip-access-policy.types.ts'
export type {
    AccessPolicyIpRulesDraft,
    AccessPolicyIpRulesParseSuccess,
    AccessPolicyIpRulesParseFailure,
    AccessPolicyIpRulesParseResult,
} from './Types/ip-access-policy.types.ts'

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

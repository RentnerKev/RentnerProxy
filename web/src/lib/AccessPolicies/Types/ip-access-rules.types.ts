import type { ACCESS_POLICY_IP_RULE_ACTIONS } from '../ipAccessRules.ts'

export type AccessPolicyIpRuleAction = (typeof ACCESS_POLICY_IP_RULE_ACTIONS)[number]

export interface ParsedNetwork {
    readonly bytes: number[]
    readonly bits: 32 | 128
    readonly prefix: number
}

export interface AccessPolicyIpRules {
    readonly defaultAction: AccessPolicyIpRuleAction
    readonly allow: ReadonlyArray<string>
    readonly deny: ReadonlyArray<string>
}

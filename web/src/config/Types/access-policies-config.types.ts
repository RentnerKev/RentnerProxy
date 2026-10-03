import type {
    ACCESS_POLICY_MODES,
    ACCESS_POLICY_COMBINATIONS,
} from '@/config/access-policies.config.ts'
export type AccessPolicyMode = (typeof ACCESS_POLICY_MODES)[number]

export type AccessPolicyCombination = (typeof ACCESS_POLICY_COMBINATIONS)[number]

export const ACCESS_POLICY_MODES = ['public', 'authenticated', 'ip-restricted', 'combined'] as const

export type AccessPolicyMode = (typeof ACCESS_POLICY_MODES)[number]

export const ACCESS_POLICY_COMBINATIONS = ['all', 'any'] as const
export type AccessPolicyCombination = (typeof ACCESS_POLICY_COMBINATIONS)[number]

export const MAX_ACCESS_POLICIES = 1_000
export const ACCESS_POLICY_NAME_MAX_LENGTH = 120
export const ACCESS_POLICY_DESCRIPTION_MAX_LENGTH = 1_000
export const MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY = 32
export const BASIC_AUTH_USERNAME_MAX_LENGTH = 64
export const BASIC_AUTH_PASSWORD_MAX_LENGTH = 256

export function isAccessPolicyMode(value: string): value is AccessPolicyMode {
    return (ACCESS_POLICY_MODES as readonly string[]).includes(value)
}

export function isAccessPolicyCombination(value: string): value is AccessPolicyCombination {
    return (ACCESS_POLICY_COMBINATIONS as readonly string[]).includes(value)
}

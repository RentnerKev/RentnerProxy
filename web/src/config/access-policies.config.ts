export const ACCESS_POLICY_MODES = ['public', 'authenticated', 'ip-restricted', 'combined'] as const

export const ACCESS_POLICY_COMBINATIONS = ['all', 'any'] as const

export const MAX_ACCESS_POLICIES = 1_000
export const ACCESS_POLICY_NAME_MAX_LENGTH = 120
export const ACCESS_POLICY_DESCRIPTION_MAX_LENGTH = 1_000
export const MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY = 32
export const BASIC_AUTH_USERNAME_MAX_LENGTH = 64
export const BASIC_AUTH_PASSWORD_MAX_LENGTH = 256
export const MAX_ACCESS_POLICY_IP_RULES = 128
export const ACCESS_POLICY_FORWARD_AUTH_PROVIDERS = [
    'generic',
    'authentik',
    'authelia',
    'oauth2-proxy',
] as const

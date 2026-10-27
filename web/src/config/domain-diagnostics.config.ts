export const DOMAIN_DIAGNOSTICS_RATE_LIMIT = {
    limit: 10,
    windowMs: 60_000,
    scope: 'domain-diagnostics-actor',
} as const
export const DOMAIN_DIAGNOSTICS_CONTROLLER_TIMEOUT_MS = 14_000
export const DOMAIN_DIAGNOSTICS_RESPONSE_LIMIT = 64 * 1_024
export const DOMAIN_DIAGNOSTICS_INPUT_LIMIT = 4 * 1_024

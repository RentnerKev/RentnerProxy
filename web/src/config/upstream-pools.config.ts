export const MAX_PROXY_UPSTREAM_MEMBERS = 16
export const PROXY_UPSTREAM_POLICIES = ['round_robin', 'first'] as const

export const UPSTREAM_FAILOVER_DEFAULTS = {
    active: {
        path: '/health',
        intervalSeconds: 10,
        timeoutSeconds: 2,
        fails: 2,
        passes: 2,
        expectedStatus: 200,
    },
    passive: { failDurationSeconds: 30, maxFails: 1 },
    retries: { maxRetries: 2, tryDurationSeconds: 5, tryIntervalMilliseconds: 250 },
} as const
export const UPSTREAM_HEALTH_OBSERVATION_MAX_AGE_MS = 30_000
export const UPSTREAM_HEALTH_OBSERVATION_FUTURE_TOLERANCE_MS = 5_000

export const HOST_MONITORING_LIMITS = {
    maxPolicies: 1_000,
    maxActiveClaims: 2,
    workerConcurrency: 1,
    pollIntervalMs: 1_000,
    leaseMs: 45_000,
    transactionTimeoutMs: 2_000,
    maxObservations: 100_000,
    maxIncidents: 10_000,
    historyLimit: 100,
    inputLimitBytes: 4_096,
    retentionSweepMs: 60_000,
    advisoryLockId: 7_421_916,
} as const

export const HOST_MONITORING_DEFAULTS = {
    enabled: false,
    intervalSeconds: 60,
    timeoutMs: 3_000,
    expectedStatus: 200,
    failureThreshold: 3,
    recoveryThreshold: 2,
    retentionDays: 7,
    sampleLimit: 1_440,
    incidentLimit: 100,
} as const

export const HOST_MONITORING_WRITE_RATE_LIMIT = {
    limit: 20,
    windowMs: 60_000,
    scope: 'host-monitoring-policy',
} as const

export const HOST_MONITORING_OUTCOME_CODES = [
    'expected_status',
    'unexpected_status',
    'upstream_unreachable',
    'upstream_timeout',
    'upstream_dns_failed',
    'tls_failed',
    'configuration_stale',
    'configuration_changed',
    'host_not_active',
    'runtime_unavailable',
    'busy',
    'invalid_response',
] as const

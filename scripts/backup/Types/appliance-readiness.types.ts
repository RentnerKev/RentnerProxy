export type ApplianceReadinessOptions = Readonly<{
    timeoutMs?: number
    probeTimeoutMs?: number
    retryIntervalMs?: number
    now?: () => number
    sleep?: (milliseconds: number) => Promise<unknown>
}>

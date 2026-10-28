export interface HostMonitoringWorkerDependencies<Claim> {
    readonly claim: () => Promise<Claim | null>
    // Owns durable completion and cancellation cleanup for an admitted probe.
    readonly runClaim: (claim: Claim, signal: AbortSignal) => Promise<void>
    readonly releaseCancelled: (claim: Claim) => Promise<void>
    readonly prune: () => Promise<void>
    // Deliberately receives no exception or target data.
    readonly unavailable: () => void
    readonly now?: () => number
    readonly schedule?: (callback: () => void, delayMs: number) => () => void
}

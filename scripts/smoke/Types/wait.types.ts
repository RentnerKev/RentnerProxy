export interface SmokeWaitOptions {
    readonly timeoutMs: number
    readonly intervalMs: number
    readonly timeoutError: () => Error
    readonly retryOnError?: (error: unknown) => boolean
    readonly probeFirst?: boolean
    readonly now?: () => number
    readonly sleep?: (milliseconds: number) => Promise<unknown>
}

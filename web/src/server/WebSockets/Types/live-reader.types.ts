export interface LiveReadResult {
    readonly kind: 'success' | 'failure'
    readonly data?: unknown
    readonly status?: number
}

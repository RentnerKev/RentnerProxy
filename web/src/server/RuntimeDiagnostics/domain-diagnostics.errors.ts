export class DomainDiagnosticsError extends Error {
    constructor(
        readonly code:
            | 'invalid_input'
            | 'configuration_changed'
            | 'busy'
            | 'runtime_unavailable'
            | 'rate_limited'
            | 'aborted',
    ) {
        super(code)
    }
}
export function assertDiagnosticsNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DomainDiagnosticsError('aborted')
}

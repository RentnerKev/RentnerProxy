export const DDNS_ACTION_ERRORS = [
    'invalid_input',
    'conflict',
    'busy',
    'disabled',
    'restore_paused',
    'stopping',
    'retry_deferred',
    'store_unavailable',
    'connection_unavailable',
    'controller_unavailable',
    'preview_required',
    'preview_failed',
    'pause_confirmation_required',
    'activation_confirmation_required',
] as const
export class DdnsDomainError extends Error {
    constructor(
        readonly code: (typeof DDNS_ACTION_ERRORS)[number],
        readonly retryAfterSeconds?: number,
    ) {
        super('DDNS operation unavailable')
        this.name = 'DdnsDomainError'
    }
}

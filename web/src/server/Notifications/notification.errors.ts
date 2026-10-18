export class NotificationDomainError extends Error {
    constructor(
        readonly code:
            | 'invalid_input'
            | 'configuration_conflict'
            | 'configuration_unavailable'
            | 'destination_required'
            | 'destination_blocked',
    ) {
        super(code)
        this.name = 'NotificationDomainError'
    }
}

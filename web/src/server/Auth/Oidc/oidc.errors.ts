export type OidcErrorCode =
    | 'invalid_input'
    | 'configuration_conflict'
    | 'configuration_unavailable'
    | 'provider_unavailable'
    | 'authentication_failed'
    | 'identity_not_allowed'
    | 'challenge_expired'

/** Carries an allowlisted error code without protocol payloads or credentials. */
export class OidcDomainError extends Error {
    constructor(readonly code: OidcErrorCode) {
        super(code)
        this.name = 'OidcDomainError'
    }
}

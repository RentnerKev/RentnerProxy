// oxlint-disable-next-line import/no-unassigned-import -- Keeps Basic Auth errors behind the server boundary.
import '@tanstack/react-start/server-only'

export type BasicAuthDomainErrorCode =
    | 'basic_auth_account_not_found'
    | 'basic_auth_username_conflict'
    | 'basic_auth_account_limit'
    | 'invalid_input'

export class BasicAuthDomainError extends Error {
    readonly code: BasicAuthDomainErrorCode

    constructor(code: BasicAuthDomainErrorCode, message = code) {
        super(message)
        this.name = 'BasicAuthDomainError'
        this.code = code
    }
}

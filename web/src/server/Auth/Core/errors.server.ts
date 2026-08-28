import '@tanstack/react-start/server-only'

export type AuthDomainErrorCode =
    | 'authentication_required'
    | 'email_conflict'
    | 'invalid_email'
    | 'invalid_input'
    | 'last_active_owner'
    | 'owner_required'
    | 'password_policy'
    | 'permission_denied'
    | 'role_in_use'
    | 'role_not_found'
    | 'service_unavailable'
    | 'system_role_immutable'
    | 'unknown_permission'
    | 'unknown_role'
    | 'user_not_active'
    | 'user_not_found'

export class AuthDomainError extends Error {
    readonly code: AuthDomainErrorCode

    constructor(code: AuthDomainErrorCode, message: string) {
        super(message)
        this.name = 'AuthDomainError'
        this.code = code
    }
}

export function isAuthDomainError(error: unknown): error is AuthDomainError {
    return error instanceof AuthDomainError
}

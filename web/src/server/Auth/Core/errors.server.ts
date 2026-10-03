import type { AuthDomainErrorCode } from './Types/errors.types.ts'
import '@tanstack/react-start/server-only'

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

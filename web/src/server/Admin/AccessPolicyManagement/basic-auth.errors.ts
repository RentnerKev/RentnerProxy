import type { BasicAuthDomainErrorCode } from './Types/basic-auth-errors.types.ts'
// oxlint-disable-next-line import/no-unassigned-import -- Keeps Basic Auth errors behind the server boundary.
import '@tanstack/react-start/server-only'

export class BasicAuthDomainError extends Error {
    readonly code: BasicAuthDomainErrorCode

    constructor(code: BasicAuthDomainErrorCode, message = code) {
        super(message)
        this.name = 'BasicAuthDomainError'
        this.code = code
    }
}

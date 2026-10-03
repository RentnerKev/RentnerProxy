import type { AccessPolicyDomainErrorCode } from './Types/access-policies-errors.types.ts'
// oxlint-disable-next-line import/no-unassigned-import -- Marks this domain error module as server-only.
import '@tanstack/react-start/server-only'

export class AccessPolicyDomainError extends Error {
    readonly code: AccessPolicyDomainErrorCode

    constructor(code: AccessPolicyDomainErrorCode, message = code) {
        super(message)
        this.name = 'AccessPolicyDomainError'
        this.code = code
    }
}

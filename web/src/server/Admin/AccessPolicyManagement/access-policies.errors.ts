// oxlint-disable-next-line import/no-unassigned-import -- Marks this domain error module as server-only.
import '@tanstack/react-start/server-only'

export type AccessPolicyDomainErrorCode =
    | 'access_policy_not_found'
    | 'access_policy_in_use'
    | 'invalid_input'
    | 'controller_unavailable'

export class AccessPolicyDomainError extends Error {
    readonly code: AccessPolicyDomainErrorCode

    constructor(code: AccessPolicyDomainErrorCode, message = code) {
        super(message)
        this.name = 'AccessPolicyDomainError'
        this.code = code
    }
}

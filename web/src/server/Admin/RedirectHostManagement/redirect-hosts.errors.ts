// oxlint-disable-next-line import/no-unassigned-import -- Marks this domain error module as server-only.
import '@tanstack/react-start/server-only'

import { mapHostDomainUniqueViolation } from '../ProxyHostManagement/proxy-hosts.errors'

export type RedirectHostDomainErrorCode =
    | 'domain_conflict'
    | 'host_not_found'
    | 'invalid_status_transition'
    | 'invalid_input'

export class RedirectHostDomainError extends Error {
    readonly code: RedirectHostDomainErrorCode

    constructor(code: RedirectHostDomainErrorCode, message: string) {
        super(message)
        this.name = 'RedirectHostDomainError'
        this.code = code
    }
}

export function mapRedirectHostDomainUniqueViolation(
    error: unknown,
): RedirectHostDomainError | null {
    const conflict = mapHostDomainUniqueViolation(error)
    return conflict
        ? new RedirectHostDomainError(
              'domain_conflict',
              'A redirect host domain is already in use.',
          )
        : null
}

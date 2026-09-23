// oxlint-disable-next-line import/no-unassigned-import -- Keeps CrowdSec domain errors behind the server boundary.
import '@tanstack/react-start/server-only'

export type CrowdSecErrorCode =
    | 'invalid_input'
    | 'api_key_required'
    | 'connection_failed'
    | 'controller_unavailable'
    | 'configuration_conflict'
    | 'configuration_unavailable'
    | 'community_not_ready'
    | 'enrollment_failed'

export class CrowdSecDomainError extends Error {
    constructor(readonly code: CrowdSecErrorCode) {
        super(code)
        this.name = 'CrowdSecDomainError'
    }
}

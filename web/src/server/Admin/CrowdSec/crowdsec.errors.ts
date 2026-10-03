import type { CrowdSecErrorCode } from './Types/crowdsec-errors.types.ts'
// oxlint-disable-next-line import/no-unassigned-import -- Keeps CrowdSec domain errors behind the server boundary.
import '@tanstack/react-start/server-only'

export class CrowdSecDomainError extends Error {
    constructor(readonly code: CrowdSecErrorCode) {
        super(code)
        this.name = 'CrowdSecDomainError'
    }
}

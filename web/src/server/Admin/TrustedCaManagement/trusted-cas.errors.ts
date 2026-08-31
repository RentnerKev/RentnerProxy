// oxlint-disable-next-line import/no-unassigned-import -- Keeps trusted-CA domain errors behind the server boundary.
import '@tanstack/react-start/server-only'

import type { TrustedCaErrorCode } from '../../../config/trusted-cas.config'

export class TrustedCaDomainError extends Error {
    constructor(readonly code: TrustedCaErrorCode) {
        super(code)
        this.name = 'TrustedCaDomainError'
    }
}

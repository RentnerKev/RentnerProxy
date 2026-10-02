// oxlint-disable-next-line import/no-unassigned-import -- Keeps trusted-CA domain errors behind the server boundary.
import '@tanstack/react-start/server-only'

import type { TrustedCaErrorCode } from '@/shared/Types/trusted-cas-config.types.ts'

export class TrustedCaDomainError extends Error {
    constructor(readonly code: TrustedCaErrorCode) {
        super(code)
        this.name = 'TrustedCaDomainError'
    }
}

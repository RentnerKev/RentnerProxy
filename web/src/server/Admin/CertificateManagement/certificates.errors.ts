// oxlint-disable-next-line import/no-unassigned-import -- Keeps certificate domain errors behind the server boundary.
import '@tanstack/react-start/server-only'
import type { CertificateErrorCode } from '@/config/Types/certificates-config.types.ts'

export class CertificateDomainError extends Error {
    constructor(readonly code: CertificateErrorCode) {
        super(code)
        this.name = 'CertificateDomainError'
    }
}

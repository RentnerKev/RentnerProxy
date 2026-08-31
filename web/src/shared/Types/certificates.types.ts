import type {
    AcmeEnvironment,
    CertificateErrorCode,
    CertificateOperation,
    CertificateSource,
    CertificateStatus,
} from '../../config/certificates.config'

export interface CertificateSummary {
    readonly id: string
    readonly name: string
    readonly domains: Array<string>
    readonly source: CertificateSource
    readonly environment: AcmeEnvironment | null
    readonly status: CertificateStatus
    readonly operation: CertificateOperation
    readonly issuedAt: Date | null
    readonly expiresAt: Date | null
    readonly issuer: string | null
    readonly fingerprint: string | null
    readonly lastErrorCode: CertificateErrorCode | null
    readonly assignedHostCount: number
    readonly createdAt: Date
    readonly updatedAt: Date
}

export type CertificateActionResult =
    | { readonly success: true; readonly message: string; readonly certificateId?: string }
    | { readonly success: false; readonly message: string }

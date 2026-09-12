import type {
    AcmeChallengeType,
    AcmeEnvironment,
    CertificateEventKind,
    CertificateErrorCode,
    CertificateOperation,
    CertificateOperationKind,
    CertificateOperationStage,
    CertificateSource,
    CertificateStatus,
} from '../../config/certificates.config'

export interface CertificateCurrentOperationMetadata {
    readonly id: string
    readonly kind: CertificateOperationKind
    readonly stage: CertificateOperationStage
    readonly startedAt: string
    readonly updatedAt: string
}

export interface CertificateCurrentOperation {
    readonly id: string
    readonly kind: CertificateOperationKind
    readonly stage: CertificateOperationStage
    readonly startedAt: Date
    readonly updatedAt: Date
}

export interface CertificateEventMetadata {
    readonly id: string
    readonly operationId: string
    readonly certificateId: string
    readonly kind: CertificateEventKind
    readonly stage: CertificateOperationStage
    readonly occurredAt: string
    readonly errorCode: CertificateErrorCode | null
}

export interface CertificateEvent {
    readonly id: string
    readonly operationId: string
    readonly certificateId: string
    readonly kind: CertificateEventKind
    readonly stage: CertificateOperationStage
    readonly occurredAt: Date
    readonly errorCode: CertificateErrorCode | null
}

export interface CertificateEventPage {
    readonly events: readonly CertificateEventMetadata[]
    readonly nextCursor: string
    readonly hasMore: boolean
    readonly resetRequired: boolean
}

export interface CertificateCandidateMetadata {
    readonly fingerprint: string
    readonly issuedAt: string
    readonly expiresAt: string
    readonly lastErrorCode: CertificateErrorCode | null
    readonly nextAttemptAt: string | null
}

export interface CertificateCandidate {
    readonly fingerprint: string
    readonly issuedAt: Date
    readonly expiresAt: Date
    readonly lastErrorCode: CertificateErrorCode | null
    readonly nextAttemptAt: Date | null
}

export interface CertificateSummary {
    readonly id: string
    readonly name: string
    readonly domains: Array<string>
    readonly source: CertificateSource
    readonly environment: AcmeEnvironment | null
    readonly status: CertificateStatus
    readonly operation: CertificateOperation
    readonly currentOperation?: CertificateCurrentOperation | null
    readonly challengeType?: AcmeChallengeType | null
    readonly issuedAt: Date | null
    readonly expiresAt: Date | null
    readonly issuer: string | null
    readonly fingerprint: string | null
    readonly candidate: CertificateCandidate | null
    readonly dnsCleanupPending: boolean
    readonly lastErrorCode: CertificateErrorCode | null
    readonly lastActivatedAt?: Date | null
    readonly lastErrorAt?: Date | null
    readonly nextAttemptAt?: Date | null
    readonly attemptCount?: number
    readonly lastAttemptAt?: Date | null
    readonly lastSuccessAt?: Date | null
    readonly nextRenewalAt?: Date | null
    readonly assignedHostCount: number
    readonly createdAt: Date
    readonly updatedAt: Date
}

export type CertificateActionResult =
    | { readonly success: true; readonly message: string; readonly certificateId?: string }
    | { readonly success: false; readonly message: string }

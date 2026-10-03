import type {
    CERTIFICATE_SOURCES,
    ACME_ENVIRONMENTS,
    ACME_CHALLENGE_TYPES,
    CERTIFICATE_STORED_STATUSES,
    CERTIFICATE_OPERATIONS,
    CERTIFICATE_OPERATION_KINDS,
    CERTIFICATE_OPERATION_STAGES,
    CERTIFICATE_EVENT_KINDS,
    CERTIFICATE_ERROR_CODES,
} from '@/config/certificates.config.ts'
export type CertificateSource = (typeof CERTIFICATE_SOURCES)[number]

export type AcmeEnvironment = (typeof ACME_ENVIRONMENTS)[number]

export type AcmeChallengeType = (typeof ACME_CHALLENGE_TYPES)[number]

export type CertificateStoredStatus = (typeof CERTIFICATE_STORED_STATUSES)[number]

export type CertificateStatus = CertificateStoredStatus | 'expiring' | 'expired'

export type CertificateOperation = (typeof CERTIFICATE_OPERATIONS)[number]

export type CertificateOperationKind = (typeof CERTIFICATE_OPERATION_KINDS)[number]

export type CertificateOperationStage = (typeof CERTIFICATE_OPERATION_STAGES)[number]

export type CertificateEventKind = (typeof CERTIFICATE_EVENT_KINDS)[number]

export type CertificateErrorCode = (typeof CERTIFICATE_ERROR_CODES)[number]

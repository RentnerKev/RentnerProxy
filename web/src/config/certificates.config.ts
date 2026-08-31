export const CERTIFICATE_SOURCES = ['manual', 'acme'] as const
export type CertificateSource = (typeof CERTIFICATE_SOURCES)[number]

export const ACME_ENVIRONMENTS = ['staging', 'production'] as const
export type AcmeEnvironment = (typeof ACME_ENVIRONMENTS)[number]

export const CERTIFICATE_STORED_STATUSES = ['pending', 'valid', 'failed'] as const
export type CertificateStoredStatus = (typeof CERTIFICATE_STORED_STATUSES)[number]
export type CertificateStatus = CertificateStoredStatus | 'expiring' | 'expired'
export const CERTIFICATE_OPERATIONS = ['idle', 'issuing', 'renewing'] as const
export type CertificateOperation = (typeof CERTIFICATE_OPERATIONS)[number]

export const MAX_CERTIFICATE_NAME_LENGTH = 120
export const MAX_CERTIFICATE_DOMAINS = 100
export const MAX_CERTIFICATE_PEM_LENGTH = 256 * 1_024
export const MAX_PRIVATE_KEY_PEM_LENGTH = 64 * 1_024
export const CERTIFICATE_EXPIRING_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000
export const CERTIFICATE_ERROR_CODES = [
    'invalid_input',
    'invalid_certificate',
    'key_mismatch',
    'certificate_expired',
    'domain_mismatch',
    'certificate_not_found',
    'certificate_in_use',
    'operation_in_progress',
    'acme_terms_required',
    'acme_domain_invalid',
    'acme_failed',
    'runtime_apply_failed',
    'certificate_store_unavailable',
    'controller_unavailable',
] as const
export type CertificateErrorCode = (typeof CERTIFICATE_ERROR_CODES)[number]

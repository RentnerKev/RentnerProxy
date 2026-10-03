import type { AcmeEnvironment } from '@/config/Types/certificates-config.types.ts'
export const CERTIFICATE_SOURCES = ['manual', 'acme'] as const

export const ACME_ENVIRONMENTS = ['staging', 'production'] as const

export const DEFAULT_ACME_ENVIRONMENT: AcmeEnvironment = 'production'
export const ACME_CHALLENGE_TYPES = ['http-01', 'dns-01'] as const

export const CERTIFICATE_STORED_STATUSES = ['pending', 'valid', 'failed'] as const

export const CERTIFICATE_OPERATIONS = ['idle', 'issuing', 'renewing'] as const

export const CERTIFICATE_OPERATION_KINDS = ['issue', 'renew', 'import'] as const

export const CERTIFICATE_OPERATION_STAGES = [
    'queued',
    'creating_order',
    'preparing_challenge',
    'waiting_for_validation',
    'finalizing',
    'certificate_ready',
    'applying',
    'applied',
    'retry_scheduled',
    'failed',
    'needs_attention',
] as const

export const CERTIFICATE_EVENT_KINDS = [
    'accepted',
    'started',
    'issued',
    'activated',
    'renewed',
    'retry_scheduled',
    'failed',
] as const

export const MAX_CERTIFICATE_NAME_LENGTH = 120
export const MAX_CERTIFICATE_DOMAINS = 100
export const MAX_CERTIFICATE_PEM_LENGTH = 256 * 1_024
export const MAX_PRIVATE_KEY_PEM_LENGTH = 64 * 1_024
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
    'acme_dns_required',
    'dns_provider_invalid',
    'dns_provider_unavailable',
    'dns_provider_unauthorized',
    'dns_cleanup_failed',
    'dns_credentials_unavailable',
    'runtime_apply_failed',
    'certificate_store_unavailable',
    'controller_unavailable',
] as const

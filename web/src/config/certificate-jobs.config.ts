import type { CertificateErrorCode } from './certificates.config'

export const CERTIFICATE_JOB_STAGES = [
    'preparing',
    'issuing',
    'applying',
    'applied',
    'failed',
    'needs_attention',
] as const

export type CertificateJobStage = (typeof CERTIFICATE_JOB_STAGES)[number]
export const CERTIFICATE_JOB_SUCCESS_VISIBILITY_MS = 30_000
export const CERTIFICATE_JOB_SUCCESS_TOAST_DURATION_MS = 5_000
export type CertificateJobErrorCode =
    | CertificateErrorCode
    | 'host_changed'
    | 'host_deleted'
    | 'permission_revoked'
    | 'certificate_deleted'
    | 'certificate_used_elsewhere'
    | 'idempotency_conflict'
    | 'job_not_found'

export function isCertificateJobActive(stage: CertificateJobStage): boolean {
    return stage === 'preparing' || stage === 'issuing' || stage === 'applying'
}

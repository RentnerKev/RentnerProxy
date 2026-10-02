import type { CertificateErrorCode } from './certificates-config.types.ts'
import { CERTIFICATE_JOB_STAGES } from '@/config/certificate-jobs.config.ts'
export type CertificateJobStage = (typeof CERTIFICATE_JOB_STAGES)[number]

export type CertificateJobErrorCode =
    | CertificateErrorCode
    | 'host_changed'
    | 'host_deleted'
    | 'permission_revoked'
    | 'certificate_deleted'
    | 'certificate_used_elsewhere'
    | 'idempotency_conflict'
    | 'job_not_found'

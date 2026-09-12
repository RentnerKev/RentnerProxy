import type {
    CertificateOperationKind,
    CertificateOperationStage,
} from '../../../../config/certificates.config'
import type { CertificateSummary } from '../../../../shared/Types/certificates.types'

export interface CertificateSchedulingDates {
    readonly nextRenewalAt: Date | null
    readonly nextAttemptAt: Date | null
    readonly lastAttemptAt: Date | null
    readonly lastSuccessAt: Date | null
    readonly lastActivatedAt: Date | null
    readonly lastErrorAt: Date | null
}

export interface CertificateOperationDisplay {
    readonly id: string | null
    readonly kind: CertificateOperationKind | null
    readonly stage: CertificateOperationStage | null
}

type CertificateSummaryWithLegacyScheduling = CertificateSummary & {
    readonly schedulingDates?: Partial<CertificateSchedulingDates> | null
}

function asDate(value: Date | string | null | undefined): Date | null {
    if (value === null || value === undefined) return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

export function getCertificateSchedulingDates(
    certificate: CertificateSummary,
): CertificateSchedulingDates {
    const value = certificate as CertificateSummaryWithLegacyScheduling
    const nested = value.schedulingDates
    return {
        nextRenewalAt: asDate(nested?.nextRenewalAt ?? certificate.nextRenewalAt),
        nextAttemptAt: asDate(nested?.nextAttemptAt ?? certificate.nextAttemptAt),
        lastAttemptAt: asDate(nested?.lastAttemptAt ?? certificate.lastAttemptAt),
        lastSuccessAt: asDate(nested?.lastSuccessAt ?? certificate.lastSuccessAt),
        lastActivatedAt: asDate(nested?.lastActivatedAt ?? certificate.lastActivatedAt),
        lastErrorAt: asDate(nested?.lastErrorAt ?? certificate.lastErrorAt),
    }
}

export function getCertificateOperationDisplay(
    certificate: CertificateSummary,
): CertificateOperationDisplay {
    const operation = certificate.currentOperation
    if (operation) {
        return {
            id: operation.id,
            kind: operation.kind,
            stage: operation.stage,
        }
    }

    // Older controllers only exposed the coarse operation flag. Preserve that
    // signal during a rolling upgrade without inventing a percentage or a
    // more specific stage than the controller observed.
    if (certificate.operation !== 'idle') {
        return {
            id: null,
            kind: certificate.operation === 'issuing' ? 'issue' : 'renew',
            stage: 'queued',
        }
    }

    const scheduling = getCertificateSchedulingDates(certificate)
    if (certificate.candidate?.nextAttemptAt || scheduling.nextAttemptAt) {
        return { id: null, kind: null, stage: 'retry_scheduled' }
    }
    if (certificate.lastErrorCode || certificate.candidate?.lastErrorCode) {
        return { id: null, kind: null, stage: 'failed' }
    }
    return { id: null, kind: null, stage: null }
}

export function getCertificateRetryAt(certificate: CertificateSummary): Date | null {
    return (
        certificate.candidate?.nextAttemptAt ??
        getCertificateSchedulingDates(certificate).nextAttemptAt
    )
}

export function getCertificateRetryError(certificate: CertificateSummary): string | null {
    return certificate.candidate?.lastErrorCode ?? certificate.lastErrorCode
}

export function hasActiveCertificateOperation(certificate: CertificateSummary): boolean {
    return (
        (certificate.currentOperation !== null && certificate.currentOperation !== undefined) ||
        certificate.operation !== 'idle'
    )
}

export function getCertificateOperationSearchValues(certificate: CertificateSummary): string[] {
    const operation = getCertificateOperationDisplay(certificate)
    return [
        ...(operation.id ? [operation.id] : []),
        ...(operation.kind ? [operation.kind] : []),
        ...(operation.stage ? [operation.stage] : []),
    ]
}

export function certificateOperationStageClass(stage: CertificateOperationStage): string {
    if (stage === 'failed' || stage === 'needs_attention') {
        return 'bg-danger-bg text-danger-text'
    }
    if (stage === 'retry_scheduled') return 'bg-amber-500/10 text-amber-700'
    if (stage === 'applied') return 'bg-success-bg text-success-text'
    return 'bg-info-bg text-info-text'
}

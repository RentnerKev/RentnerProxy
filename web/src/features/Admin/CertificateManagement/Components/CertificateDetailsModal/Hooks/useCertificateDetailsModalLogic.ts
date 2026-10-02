import useTranslationStore, {
    useDateFormatter,
    useDateTimeFormatter,
} from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { CertificateSummary } from '@/shared/Types/certificates.types.ts'
import {
    getCertificateOperationDisplay,
    getCertificateRetryAt,
    getCertificateRetryError,
    getCertificateSchedulingDates,
} from '@/lib/Admin/CertificateManagement/certificateOperations.ts'
import { formatCertificateDate } from '@/lib/Admin/CertificateManagement/certificateTableCells.ts'

function formatDateTime(value: Date | null, formatter: Intl.DateTimeFormat): string {
    const formatted = formatCertificateDate(value, formatter)
    return formatted === '—' ? formatted : `${formatted} UTC`
}

function certificateChallengeLabel(
    challengeType: CertificateSummary['challengeType'],
    translate: (key: string) => string,
): string {
    if (!challengeType) return '—'
    return translate(
        challengeType === 'dns-01'
            ? 'admin.certificates.challenge.dns01'
            : 'admin.certificates.challenge.http01',
    )
}

export default function useCertificateDetailsModalLogic(certificate: CertificateSummary) {
    const { t } = useTranslationStore()
    const formatter = useDateFormatter()
    const dateTimeFormatter = useDateTimeFormatter()
    const scheduling = getCertificateSchedulingDates(certificate)
    const operation = getCertificateOperationDisplay(certificate)
    const retryAt = getCertificateRetryAt(certificate)
    const retryError = getCertificateRetryError(certificate)
    const retryScheduled = Boolean(retryAt) || operation.stage === 'retry_scheduled'
    const retryStatus = retryScheduled
        ? t('admin.certificates.details.retryScheduled')
        : retryError
          ? t('admin.certificates.details.retryFailed')
          : t('admin.certificates.details.retryNone')
    const operationStage = operation.stage
        ? t(`admin.certificates.operationStages.${operation.stage}`)
        : t('admin.certificates.operation.idle')

    return {
        state: {
            scheduling,
            operation,
            retryStatus,
            operationStage,
            challengeLabel: certificateChallengeLabel(certificate.challengeType, t),
            formatDate: (value: Date | null) => formatCertificateDate(value, formatter),
            formatDateTime: (value: Date | null) => formatDateTime(value, dateTimeFormatter),
        },
    }
}

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { useEffect, useRef } from 'react'
import { continueManualDnsHandler, cancelManualDnsHandler } from '../../../middleware.ts'
import { invalidateCertificateManagementCache } from '@/lib/Admin/CertificateManagement/certificateManagementCache.ts'
import useTranslationStore, {
    useDateFormatter,
    useDateTimeFormatter,
} from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { CertificateSummary } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
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

export default function useCertificateDetailsModalLogic(
    certificate: CertificateSummary,
    canIssue = false,
    canRenew = false,
    open = true,
) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const manualDns = certificate.currentOperation?.manualDns
    const errorCode =
        manualDns?.lastErrorCode ??
        certificate.candidate?.lastErrorCode ??
        certificate.lastErrorCode
    const errorTime = manualDns?.lastCheckedAt ?? certificate.lastErrorAt?.getTime() ?? ''
    const reportedError = useRef('')
    useEffect(() => {
        if (!open || !errorCode || errorCode === 'manual_dns_cancelled') return
        const event = `${certificate.id}:${certificate.currentOperation?.id}:${errorCode}:${errorTime}`
        if (reportedError.current === event) return
        reportedError.current = event
        toast.error(t(`admin.certificates.errors.${errorCode}`), { title: t('toast.titles.error') })
    }, [open, certificate.id, certificate.currentOperation?.id, errorCode, errorTime, t])
    const canAct = certificate.currentOperation?.kind === 'renew' ? canRenew : canIssue
    const manualAction = useMutation({
        mutationFn: async (action: 'continue' | 'cancel') => {
            const operation = certificate.currentOperation
            if (!operation?.manualDns || operation.manualDns.status !== 'awaiting_input')
                throw new Error('stale')
            const data = {
                certificateId: certificate.id,
                operationId: operation.id,
                challengeSetId: operation.manualDns.challengeSetId,
            }
            return action === 'continue'
                ? continueManualDnsHandler({ data })
                : cancelManualDnsHandler({ data })
        },
        onSuccess: async (result) => {
            await invalidateCertificateManagementCache(queryClient)
            if (result.success)
                toast.success(t(result.message), { title: t('toast.titles.success') })
            else toast.error(t(result.message), { title: t('toast.titles.error') })
        },
        onError: async () => {
            await invalidateCertificateManagementCache(queryClient)
            toast.error(t('admin.certificates.errors.actionFailed'), {
                title: t('toast.titles.error'),
            })
        },
    })
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
            manualDns,
            manualPending: manualAction.isPending,
            canActOnManualDns: canAct && manualDns?.status === 'awaiting_input',
            manualCleanup: manualDns
                ? ['complete', 'cancelled', 'expired', 'failed'].includes(manualDns.status)
                : false,
            scheduling,
            operation,
            retryStatus,
            operationStage,
            challengeLabel:
                certificate.currentOperation?.dnsMode === 'manual'
                    ? `DNS-01 (${t('admin.certificates.manualDns.manual')})`
                    : certificateChallengeLabel(certificate.challengeType, t),
            formatDate: (value: Date | null) => formatCertificateDate(value, formatter),
            formatDateTime: (value: Date | null) => formatDateTime(value, dateTimeFormatter),
        },
        handler: {
            continueManualDns: () => manualAction.mutate('continue'),
            cancelManualDns: () => manualAction.mutate('cancel'),
            copy: async (value: string) => {
                try {
                    await navigator.clipboard.writeText(value)
                    toast.success(t('admin.certificates.manualDns.copied'), {
                        title: t('toast.titles.success'),
                    })
                } catch {
                    toast.error(t('admin.certificates.manualDns.copyFailed'), {
                        title: t('toast.titles.error'),
                    })
                }
            },
        },
    }
}

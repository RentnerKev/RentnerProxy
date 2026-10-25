import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { certificateManagementQueryKeys } from '@/lib/Admin/CertificateManagement/certificateManagementCache.ts'
import type { CertificateSummary } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import {
    continueManualDnsHandler,
    getCertificatesHandler,
    requestCertificateHandler,
} from '../../../middleware.ts'
import type { ManualDnsSetupGuideProps } from '../Components/ManualDnsSetupGuide/Types/manual-dns-setup-guide.types.ts'
import type {
    ManualDnsRequestSetupInputs,
    PreparedManualDnsRequest,
} from '../Types/manual-dns-request-setup.types.ts'

function sameDomains(actual: readonly string[], expected: readonly string[]): boolean {
    return JSON.stringify(actual.toSorted()) === JSON.stringify(expected.toSorted())
}

function setupState(
    certificate: CertificateSummary | undefined,
    prepared: PreparedManualDnsRequest | null,
) {
    const operation = certificate?.currentOperation
    const manual = operation?.manualDns
    const mismatch = Boolean(
        certificate &&
        prepared &&
        (certificate.source !== 'acme' ||
            certificate.environment !== prepared.input.environment ||
            !sameDomains(certificate.domains, prepared.input.domains) ||
            (certificate.challengeType && certificate.challengeType !== 'dns-01') ||
            (operation && operation.dnsMode !== 'manual') ||
            (operation && operation.kind !== 'issue') ||
            (prepared.operationId && operation?.id !== prepared.operationId) ||
            (prepared.challengeSetId && manual?.challengeSetId !== prepared.challengeSetId)),
    )
    const complete = Boolean(
        !mismatch &&
        certificate?.status === 'valid' &&
        certificate.operation === 'idle' &&
        operation?.stage === 'applied' &&
        !certificate.candidate &&
        !certificate.lastErrorCode &&
        (!manual || manual.status === 'complete'),
    )
    const expired = Boolean(manual && !complete && Date.parse(manual.expiresAt) <= Date.now())
    const terminal = Boolean(
        certificate &&
        !complete &&
        ((certificate.status === 'failed' && operation?.stage !== 'retry_scheduled') ||
            ['failed', 'needs_attention', 'cancelled', 'expired'].includes(
                operation?.stage ?? '',
            ) ||
            ['failed', 'cancelled', 'expired'].includes(manual?.status ?? '')),
    )
    const blocked = mismatch || expired || terminal
    const recordsReady = Boolean(
        !blocked &&
        manual?.status === 'awaiting_input' &&
        manual.records.length > 0 &&
        prepared?.operationId === operation?.id &&
        prepared?.challengeSetId === manual.challengeSetId,
    )
    return { operation, manual, mismatch, complete, expired, blocked, recordsReady }
}

export default function useManualDnsRequestSetup({
    enabled,
    getInput,
    reportValidationError,
    onSuccess,
}: ManualDnsRequestSetupInputs) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [prepared, setPrepared] = useState<PreparedManualDnsRequest | null>(null)
    const preparedRef = useRef<PreparedManualDnsRequest | null>(null)
    const [open, setOpen] = useState(false)
    const [ready, setReady] = useState(false)
    const [preparing, setPreparing] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const busyRef = useRef(false)
    const notifiedRef = useRef('')
    const remember = useCallback((next: PreparedManualDnsRequest) => {
        preparedRef.current = next
        setPrepared(next)
    }, [])
    const certificates = useQuery({
        queryKey: certificateManagementQueryKeys.all,
        queryFn: () => getCertificatesHandler(),
        enabled: enabled && Boolean(prepared),
        retry: false,
        refetchInterval: (query) => {
            if (!open || !enabled || !prepared || query.state.status === 'error') return false
            const certificate = query.state.data?.find(
                (entry) => entry.id === prepared.certificateId,
            )
            const current = setupState(certificate, prepared)
            return current.recordsReady || current.complete || current.blocked ? false : 1_000
        },
    })
    const certificate = certificates.data?.find((entry) => entry.id === prepared?.certificateId)
    const current = setupState(certificate, prepared)
    const loadFailed = Boolean(prepared && certificates.isError)
    const loading = Boolean(
        prepared && !loadFailed && !current.recordsReady && !current.complete && !current.blocked,
    )

    useEffect(() => {
        const previous = preparedRef.current
        const operation = certificate?.currentOperation
        if (!previous || !certificate || current.mismatch || operation?.dnsMode !== 'manual') return
        if (previous.operationId && previous.operationId !== operation.id) return
        const challengeSetId = operation.manualDns?.challengeSetId ?? null
        if (previous.challengeSetId && previous.challengeSetId !== challengeSetId) return
        if (previous.operationId !== operation.id || previous.challengeSetId !== challengeSetId)
            remember({ ...previous, operationId: operation.id, challengeSetId })
    }, [certificate, current.mismatch, remember])
    useEffect(() => {
        if (!enabled || !prepared) return
        const code = current.expired
            ? 'manual_dns_expired'
            : current.mismatch
              ? 'operation_in_progress'
              : (current.manual?.lastErrorCode ??
                certificate?.lastErrorCode ??
                (current.blocked ? 'manual_dns_order_invalid' : null))
        const signature = loadFailed
            ? `load:${certificates.errorUpdatedAt}`
            : code
              ? `${prepared.certificateId}:${current.operation?.id}:${code}`
              : ''
        if (!signature || signature === notifiedRef.current) return
        notifiedRef.current = signature
        toast.error(
            t(
                loadFailed
                    ? 'admin.certificates.errors.loadFailed'
                    : `admin.certificates.errors.${code}`,
            ),
            { title: t('toast.titles.error') },
        )
    }, [
        enabled,
        prepared,
        loadFailed,
        certificates.errorUpdatedAt,
        current.expired,
        current.mismatch,
        current.blocked,
        current.manual?.lastErrorCode,
        current.operation?.id,
        certificate?.lastErrorCode,
        t,
    ])

    const prepare = useCallback(async () => {
        if (!enabled || busyRef.current || preparedRef.current) return
        let input
        try {
            input = getInput()
        } catch {
            reportValidationError()
            return
        }
        if (input.challengeType !== 'dns-01' || input.dnsMode !== 'manual') return
        busyRef.current = true
        setPreparing(true)
        try {
            const result = await requestCertificateHandler({ data: input })
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                setOpen(false)
                return
            }
            if (!result.certificateId) throw new Error('missing-certificate')
            remember({
                certificateId: result.certificateId,
                input,
                operationId: null,
                challengeSetId: null,
            })
            setReady(false)
            void queryClient
                .invalidateQueries({ queryKey: certificateManagementQueryKeys.all })
                .catch(() => undefined)
        } catch {
            toast.error(t('admin.certificates.errors.requestFailed'), {
                title: t('toast.titles.error'),
            })
            setOpen(false)
        } finally {
            busyRef.current = false
            setPreparing(false)
        }
    }, [enabled, getInput, reportValidationError, queryClient, remember, t])
    const openGuide = useCallback(() => {
        if (!enabled || busyRef.current) return
        if (!preparedRef.current) {
            try {
                getInput()
            } catch {
                reportValidationError()
                return
            }
        }
        setOpen(true)
        if (!preparedRef.current) void prepare()
    }, [enabled, getInput, reportValidationError, prepare])
    const submit = useCallback(async () => {
        const request = preparedRef.current
        if (!enabled || busyRef.current || !request) return
        const latest = queryClient
            .getQueryData<CertificateSummary[]>(certificateManagementQueryKeys.all)
            ?.find((entry) => entry.id === request.certificateId)
        const validation = setupState(latest, request)
        if (
            !ready ||
            certificates.isError ||
            validation.blocked ||
            (!validation.recordsReady && !validation.complete)
        ) {
            toast.error(
                t(
                    `admin.certificates.errors.${validation.expired ? 'manual_dns_expired' : 'operation_in_progress'}`,
                ),
                { title: t('toast.titles.error') },
            )
            return
        }
        let input
        try {
            input = getInput()
        } catch {
            reportValidationError()
            return
        }
        if (
            !sameDomains(input.domains, request.input.domains) ||
            input.environment !== request.input.environment ||
            input.dnsMode !== 'manual'
        ) {
            toast.error(t('admin.certificates.errors.operation_in_progress'), {
                title: t('toast.titles.error'),
            })
            return
        }
        busyRef.current = true
        setSubmitting(true)
        try {
            if (!validation.complete) {
                const result = await continueManualDnsHandler({
                    data: {
                        certificateId: request.certificateId,
                        operationId: request.operationId!,
                        challengeSetId: request.challengeSetId!,
                    },
                })
                if (!result.success) {
                    toast.error(t(result.message), { title: t('toast.titles.error') })
                    return
                }
                toast.success(t(result.message), { title: t('toast.titles.success') })
            }
            void queryClient
                .invalidateQueries({ queryKey: certificateManagementQueryKeys.all })
                .catch(() => undefined)
            // The request was accepted; a view refresh must not turn it into a failed request.
            try {
                await onSuccess(request.certificateId)
            } catch {}
        } catch {
            toast.error(t('admin.certificates.errors.actionFailed'), {
                title: t('toast.titles.error'),
            })
        } finally {
            busyRef.current = false
            setSubmitting(false)
        }
    }, [
        enabled,
        ready,
        certificates.isError,
        getInput,
        reportValidationError,
        queryClient,
        onSuccess,
        t,
    ])
    const guide: ManualDnsSetupGuideProps = {
        open,
        preparing,
        loading,
        loadFailed,
        blocked: current.blocked,
        complete: current.complete,
        recordsReady: current.recordsReady && !loadFailed,
        records: current.manual?.records ?? [],
        expiresAt: current.manual?.expiresAt ?? null,
        onOpenChange: (value) => {
            if (!busyRef.current) setOpen(value)
        },
        onRetry: () => void certificates.refetch(),
        onDone: () => {
            if (current.blocked || loadFailed || (!current.complete && !current.recordsReady))
                return
            setReady(true)
            setOpen(false)
        },
        onCopy: async (value) => {
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
    }
    return {
        guide,
        openGuide,
        submit,
        busy: preparing || submitting,
        hasPrepared: Boolean(prepared),
        canRequest:
            ready && !loadFailed && !current.blocked && (current.recordsReady || current.complete),
    }
}

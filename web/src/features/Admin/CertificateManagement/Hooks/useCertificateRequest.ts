import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useId, useState } from 'react'
import { isCertificateJobActive } from '@/lib/CertificateJobs/stages.ts'
import { DEFAULT_ACME_ENVIRONMENT } from '@/config/certificates.config.ts'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { requestCertificateHandler } from '../middleware.ts'
import {
    requestProxyHostCertificateHandler,
    retryCertificateJobHandler,
} from '@/features/Admin/ProxyHostManagement/CertificateJobs/middleware.ts'
import { publishCertificateJobProgress } from '@/lib/Admin/ProxyHostManagement/CertificateJobs/certificateJobsCache.ts'
import {
    certificateRequestFormSchema,
    certificateRequestInputFromForm,
    requestCertificateInputSchema,
    type CertificateRequestFormValues,
} from '../validation.ts'
import type { CertificateRequestInputs } from '../Types/certificate-management.types.ts'

/** Builds and submits certificate requests, including reset and retry behavior. */
export default function useCertificateRequest({
    certificateJob,
    expectedUpdatedAt,
    initialDomains,
    initialName,
    proxyHostId,
    readOnlyDomains = false,
    onSuccess,
}: CertificateRequestInputs) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const formId = useId()
    const [isPending, setIsPending] = useState(false)
    const [idempotencyKey] = useState(() => crypto.randomUUID())
    const retryableJob = Boolean(
        certificateJob &&
        (certificateJob.stage === 'failed' ||
            certificateJob.stage === 'needs_attention' ||
            (isCertificateJobActive(certificateJob.stage) &&
                certificateJob.lastErrorCode !== null)),
    )
    const getRequestInput = useCallback(
        (value: Parameters<typeof certificateRequestInputFromForm>[0]) =>
            requestCertificateInputSchema.parse(certificateRequestInputFromForm(value)),
        [],
    )
    const defaultValues: CertificateRequestFormValues = {
        name: initialName ?? '',
        domains: initialDomains ? [...initialDomains] : [''],
        environment: DEFAULT_ACME_ENVIRONMENT,
        challengeType: 'http-01',
        dnsZoneId: '',
        dnsApiToken: '',
        contactEmail: '',
        acceptTerms: false,
    }
    const form = useForm({
        defaultValues,
        onSubmit: async ({ value }) => {
            if (isPending) return
            setIsPending(true)
            try {
                const parsed = retryableJob ? null : getRequestInput(value)
                const result = retryableJob
                    ? await retryCertificateJobHandler({ data: { jobId: certificateJob!.id } })
                    : proxyHostId
                      ? await requestProxyHostCertificateHandler({
                            data: {
                                idempotencyKey,
                                proxyHostId,
                                expectedUpdatedAt: expectedUpdatedAt ?? new Date().toISOString(),
                                request: (() => {
                                    const { domains: _domains, ...request } = parsed!
                                    return request
                                })(),
                            },
                        })
                      : await requestCertificateHandler({ data: parsed! })
                if (!result.success) {
                    toast.error(t(result.message), { title: t('toast.titles.error') })
                    return
                }
                const resetValues: CertificateRequestFormValues = {
                    name: '',
                    domains: [''],
                    environment: DEFAULT_ACME_ENVIRONMENT,
                    challengeType: 'http-01',
                    dnsZoneId: '',
                    dnsApiToken: '',
                    contactEmail: '',
                    acceptTerms: false,
                }
                form.reset(resetValues)
                if ('job' in result) {
                    await publishCertificateJobProgress(queryClient, result.job)
                } else {
                    toast.success(t(result.message), { title: t('toast.titles.success') })
                }
                await onSuccess()
            } catch {
                toast.error(t('admin.certificates.errors.requestFailed'), {
                    title: t('toast.titles.error'),
                })
            } finally {
                setIsPending(false)
            }
        },
        validators: retryableJob ? {} : { onSubmit: certificateRequestFormSchema },
    })
    return { form, formId, isPending, getRequestInput, readOnlyDomains, retryableJob }
}

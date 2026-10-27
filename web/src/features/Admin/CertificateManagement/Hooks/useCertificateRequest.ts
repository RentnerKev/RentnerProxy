import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useId, useState } from 'react'
import { isCertificateJobActive } from '@/lib/CertificateJobs/stages.ts'
import { DEFAULT_ACME_ENVIRONMENT } from '@/config/certificates.config.ts'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { supportsDns01 } from '@/lib/DnsConnections/dnsProviders.ts'
import getFieldErrorMessage, { getValidationIssue } from '@/lib/Forms/fieldErrors.ts'
import { requestCertificateHandler, getCertificateDnsProvidersHandler } from '../middleware.ts'
import {
    requestProxyHostCertificateHandler,
    retryCertificateJobHandler,
} from '@/features/Admin/ProxyHostManagement/CertificateJobs/middleware.ts'
import { publishCertificateJobProgress } from '@/lib/Admin/ProxyHostManagement/CertificateJobs/certificateJobsCache.ts'
import {
    certificateRequestFormSchema,
    certificateRequestInputFromForm,
    requestCertificateInputSchema,
} from '../validation.ts'
import type { CertificateRequestFormValues } from '../Types/validation.types.ts'
import type { CertificateRequestInputs } from '../Types/certificate-management.types.ts'
import {
    connectionSupportsOperation,
    verifiedConnectionZones,
    zoneCoversDomains,
} from '@/lib/DnsConnections/connectionEligibility.ts'
import type { DnsConnectionChoice } from '@/lib/DnsConnections/Types/dns-connections.types.ts'

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
        (value: Parameters<typeof certificateRequestInputFromForm>[0]) => {
            if (value.challengeType === 'dns-01' && value.dnsMode !== 'manual') {
                const providers = queryClient.getQueryData<
                    Awaited<ReturnType<typeof getCertificateDnsProvidersHandler>>
                >(['dns-providers', 'certificates'])
                if (
                    queryClient.getQueryState(['dns-providers', 'certificates'])?.status ===
                        'error' ||
                    !providers?.some(supportsDns01)
                )
                    throw new Error('admin.dnsConnections.providers.unavailable')
                const connections = queryClient.getQueryData<readonly DnsConnectionChoice[]>([
                    'dns-connections',
                    'certificates',
                ])
                const connection = connections?.find((item) => item.id === value.dnsConnectionId)
                if (
                    queryClient.getQueryState(['dns-connections', 'certificates'])?.status ===
                        'error' ||
                    !connection ||
                    !connectionSupportsOperation(connection, providers, 'dns01') ||
                    !verifiedConnectionZones(connection).some(
                        (zone) =>
                            zone.id === value.dnsZoneId && zoneCoversDomains(zone, value.domains),
                    )
                )
                    throw new Error('admin.providers.validation.connection')
            }
            return requestCertificateInputSchema.parse(certificateRequestInputFromForm(value))
        },
        [queryClient],
    )
    const defaultValues: CertificateRequestFormValues = {
        name: initialName ?? '',
        domains: initialDomains ? [...initialDomains] : [''],
        environment: DEFAULT_ACME_ENVIRONMENT,
        challengeType: 'http-01',
        dnsMode: 'provider',
        dnsZoneId: '',
        dnsApiToken: '',
        dnsConnectionId: '',
        dnsConnectionProvider: 'cloudflare',
        contactEmail: '',
        acceptTerms: false,
    }
    const reportValidationError = useCallback(
        (values: CertificateRequestFormValues) => {
            const issue = getValidationIssue(certificateRequestFormSchema, values)
            toast.error(
                getFieldErrorMessage(issue ? [issue] : [], t) ?? t('validation.invalidValue'),
                {
                    title: t('toast.titles.error'),
                },
            )
        },
        [t],
    )
    const form = useForm({
        defaultValues,
        onSubmitInvalid: ({ value }) => reportValidationError(value),
        onSubmit: async ({ value }) => {
            if (isPending) return
            setIsPending(true)
            try {
                if (!retryableJob && proxyHostId && !expectedUpdatedAt) {
                    throw new Error('Missing proxy host revision.')
                }
                const parsed = retryableJob ? null : getRequestInput(value)
                const result = retryableJob
                    ? await retryCertificateJobHandler({ data: { jobId: certificateJob!.id } })
                    : proxyHostId
                      ? await requestProxyHostCertificateHandler({
                            data: {
                                idempotencyKey,
                                proxyHostId,
                                expectedUpdatedAt: expectedUpdatedAt!,
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
                    dnsMode: 'provider',
                    dnsZoneId: '',
                    dnsApiToken: '',
                    dnsConnectionId: '',
                    dnsConnectionProvider: 'cloudflare',
                    contactEmail: '',
                    acceptTerms: false,
                }
                form.reset(resetValues)
                if ('job' in result) {
                    await publishCertificateJobProgress(queryClient, result.job)
                } else {
                    toast.success(t(result.message), { title: t('toast.titles.success') })
                }
                await onSuccess('certificateId' in result ? result.certificateId : undefined)
            } catch (error) {
                toast.error(
                    t(
                        error instanceof Error &&
                            (error.message === 'admin.dnsConnections.providers.unavailable' ||
                                error.message === 'admin.providers.validation.connection')
                            ? error.message
                            : 'admin.certificates.errors.requestFailed',
                    ),
                    {
                        title: t('toast.titles.error'),
                    },
                )
            } finally {
                setIsPending(false)
            }
        },
        validators: retryableJob ? {} : { onSubmit: certificateRequestFormSchema },
    })
    return {
        form,
        formId,
        isPending,
        getRequestInput,
        reportValidationError,
        readOnlyDomains,
        retryableJob,
    }
}

import { useForm } from '@tanstack/react-form'
import { useCallback, useId, useState } from 'react'
import { isCertificateJobActive } from '../../../../config/certificate-jobs.config'
import { DEFAULT_ACME_ENVIRONMENT } from '../../../../config/certificates.config'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import { requestCertificateHandler } from '../server'
import {
    requestProxyHostCertificateHandler,
    retryCertificateJobHandler,
} from '../../ProxyHostManagement/CertificateJobs/server'
import {
    certificateRequestFormSchema,
    certificateRequestInputFromForm,
    requestCertificateInputSchema,
    type CertificateRequestFormValues,
} from '../validation'
import type { CertificateRequestModalProps } from '../Types/certificate-management.types'

/** Builds and submits certificate requests, including reset and retry behavior. */
export default function useCertificateRequestLogic({
    certificateJob,
    expectedUpdatedAt,
    initialDomains,
    initialName,
    proxyHostId,
    readOnlyDomains = false,
    onSuccess,
}: CertificateRequestModalProps) {
    const toast = useToast()
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
                    toast.error(result.message)
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
                toast.success(result.message)
                await onSuccess()
            } catch {
                toast.error('admin.certificates.errors.requestFailed')
            } finally {
                setIsPending(false)
            }
        },
        validators: retryableJob ? {} : { onSubmit: certificateRequestFormSchema },
    })
    return { form, formId, isPending, getRequestInput, readOnlyDomains, retryableJob }
}

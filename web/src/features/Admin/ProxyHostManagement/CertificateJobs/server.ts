import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import { CERTIFICATE_ERROR_CODES } from '../../../../config/certificates.config'
import type {
    CertificateJobActionResult,
    CertificateJobSummary,
} from '../../../../shared/Types/certificate-jobs.types'
import { CertificateDomainError } from '../../../../server/Admin/CertificateManagement/certificates.errors'
import { ProxyHostDomainError } from '../../../../server/Admin/ProxyHostManagement/proxy-hosts.errors'
import { CertificateJobDomainError } from '../../../../server/Admin/ProxyHostManagement/certificate-jobs.storage.server'
import {
    createProxyHostWithCertificateService,
    updateProxyHostWithCertificateService,
    requestProxyHostCertificateService,
    getCertificateJobService,
    retryCertificateJobService,
} from '../../../../server/Admin/ProxyHostManagement/certificate-jobs.service'
import { localizedActionFailure, throwLocalizedQueryError } from '../../../Auth/serverHelpers'
import {
    certificateJobIdInputSchema,
    createProxyHostWithCertificateInputSchema,
    updateProxyHostWithCertificateInputSchema,
    requestProxyHostCertificateInputSchema,
} from '../certificate-job-validation'

async function jobAction(
    action: () => Promise<CertificateJobSummary>,
    message: string,
): Promise<CertificateJobActionResult> {
    setResponseHeader('Cache-Control', 'private, no-store')
    try {
        return { success: true, message, job: await action() }
    } catch (error) {
        if (error instanceof CertificateJobDomainError) {
            setResponseStatus(error.code === 'job_not_found' ? 404 : 409)
            const prefix = (CERTIFICATE_ERROR_CODES as readonly string[]).includes(error.code)
                ? 'admin.certificates.errors'
                : 'admin.proxyHosts.certificateJob.errors'
            return { success: false, message: `${prefix}.${error.code}` }
        }
        if (error instanceof CertificateDomainError) {
            setResponseStatus(error.code === 'controller_unavailable' ? 503 : 422)
            return { success: false, message: `admin.certificates.errors.${error.code}` }
        }
        if (error instanceof ProxyHostDomainError) {
            setResponseStatus(
                error.code === 'proxy_host_not_found'
                    ? 404
                    : error.code === 'invalid_input'
                      ? 400
                      : 409,
            )
            return { success: false, message: `admin.proxyHosts.errors.${error.code}` }
        }
        return localizedActionFailure(error, 'admin.proxyHosts.certificateJob.errors.actionFailed')
    }
}

export const createProxyHostWithCertificateHandler = createServerFn({ method: 'POST' })
    .validator(createProxyHostWithCertificateInputSchema)
    .handler(({ data }) =>
        jobAction(
            () => createProxyHostWithCertificateService(data),
            'admin.proxyHosts.certificateJob.messages.queued',
        ),
    )

export const updateProxyHostWithCertificateHandler = createServerFn({ method: 'POST' })
    .validator(updateProxyHostWithCertificateInputSchema)
    .handler(({ data }) =>
        jobAction(
            () => updateProxyHostWithCertificateService(data),
            'admin.proxyHosts.certificateJob.messages.queued',
        ),
    )

export const requestProxyHostCertificateHandler = createServerFn({ method: 'POST' })
    .validator(requestProxyHostCertificateInputSchema)
    .handler(({ data }) =>
        jobAction(
            () => requestProxyHostCertificateService(data),
            'admin.proxyHosts.certificateJob.messages.queued',
        ),
    )

export const getCertificateJobHandler = createServerFn({ method: 'GET' })
    .validator(certificateJobIdInputSchema)
    .handler(async ({ data }) => {
        setResponseHeader('Cache-Control', 'private, no-store')
        try {
            return await getCertificateJobService(data.jobId)
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.proxyHosts.certificateJob.errors.loadFailed')
        }
    })

export const retryCertificateJobHandler = createServerFn({ method: 'POST' })
    .validator(certificateJobIdInputSchema)
    .handler(({ data }) =>
        jobAction(
            () => retryCertificateJobService(data.jobId),
            'admin.proxyHosts.certificateJob.messages.retried',
        ),
    )

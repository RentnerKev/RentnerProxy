import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import type { CertificateActionResult } from '../../../shared/Types/certificates.types'
import { CertificateDomainError } from '../../../server/Admin/CertificateManagement/certificates.errors'
import {
    deleteCertificateService,
    getAssignableCertificatesService,
    getCertificateDetailsService,
    getCertificatesService,
    importCertificateService,
    renewCertificateService,
    replaceCertificateService,
    requestCertificateService,
} from '../../../server/Admin/CertificateManagement/certificates.service'
import { localizedActionFailure, throwLocalizedQueryError } from '../../Auth/serverHelpers'
import {
    certificateIdInputSchema,
    importCertificateInputSchema,
    replaceCertificateInputSchema,
    requestCertificateInputSchema,
} from './validation'

function noStore(): void {
    setResponseHeader('Cache-Control', 'private, no-store')
}

async function certificateAction(
    action: () => Promise<string | void>,
    message: string,
): Promise<CertificateActionResult> {
    noStore()
    try {
        const certificateId = await action()
        return { success: true, message, ...(certificateId ? { certificateId } : {}) }
    } catch (error) {
        if (error instanceof CertificateDomainError) {
            setResponseStatus(
                error.code === 'certificate_not_found'
                    ? 404
                    : error.code === 'certificate_in_use' || error.code === 'operation_in_progress'
                      ? 409
                      : error.code === 'controller_unavailable' ||
                          error.code === 'certificate_store_unavailable'
                        ? 503
                        : 422,
            )
            return { success: false, message: `admin.certificates.errors.${error.code}` }
        }
        return localizedActionFailure(error, 'admin.certificates.errors.actionFailed')
    }
}

export const getCertificatesHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return await getCertificatesService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.certificates.errors.loadFailed')
    }
})

export const getAssignableCertificatesHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        noStore()
        try {
            return await getAssignableCertificatesService()
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.certificates.errors.loadFailed')
        }
    },
)

export const getCertificateDetailsHandler = createServerFn({ method: 'GET' })
    .validator(certificateIdInputSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            return await getCertificateDetailsService(data.certificateId)
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.certificates.errors.loadFailed')
        }
    })

export const importCertificateHandler = createServerFn({ method: 'POST' })
    .validator(importCertificateInputSchema)
    .handler(({ data }) =>
        certificateAction(
            () => importCertificateService(data),
            'admin.certificates.messages.imported',
        ),
    )

export const replaceCertificateHandler = createServerFn({ method: 'POST' })
    .validator(replaceCertificateInputSchema)
    .handler(({ data }) =>
        certificateAction(
            () => replaceCertificateService(data),
            'admin.certificates.messages.replaced',
        ),
    )

export const requestCertificateHandler = createServerFn({ method: 'POST' })
    .validator(requestCertificateInputSchema)
    .handler(({ data }) =>
        certificateAction(
            () => requestCertificateService(data),
            'admin.certificates.messages.requested',
        ),
    )

export const renewCertificateHandler = createServerFn({ method: 'POST' })
    .validator(certificateIdInputSchema)
    .handler(({ data }) =>
        certificateAction(
            () => renewCertificateService(data.certificateId),
            'admin.certificates.messages.renewing',
        ),
    )

export const deleteCertificateHandler = createServerFn({ method: 'POST' })
    .validator(certificateIdInputSchema)
    .handler(({ data }) =>
        certificateAction(
            () => deleteCertificateService(data.certificateId),
            'admin.certificates.messages.deleted',
        ),
    )

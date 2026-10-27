import {
    getDnsProvidersService,
    getCertificateDnsConnectionsService,
} from '@/server/Admin/DnsConnections/dns-providers.service.ts'
import { quickSearchInputSchema } from '@/lib/QuickSearch/quickSearchValidation.ts'
import { searchCertificatesService } from '@/server/Admin/CertificateManagement/certificates.service.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    dnsSetupInputSchema,
    manualDnsCheckInputSchema,
} from '@/lib/Admin/CertificateManagement/dnsSetupValidation.ts'
import type {
    DnsSetupActionResult,
    ManualDnsCheckActionResult,
} from '@/lib/Admin/CertificateManagement/Types/dns-setup.types.ts'
import {
    inspectCertificateDnsSetupService,
    checkManualDnsService,
} from '@/server/Admin/CertificateManagement/dns-setup.service.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import type { CertificateActionResult } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import { CertificateDomainError } from '@/server/Admin/CertificateManagement/certificates.errors.ts'
import {
    actOnManualDnsService,
    cancelDelegatedCertificateService,
    deleteCertificateService,
    getAssignableCertificatesService,
    getCertificatesService,
    importCertificateService,
    renewCertificateService,
    replaceCertificateService,
    requestCertificateService,
} from '@/server/Admin/CertificateManagement/certificates.service.ts'
import { localizedActionFailure, throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'
import {
    manualDnsActionInputSchema,
    cancelDelegatedCertificateInputSchema,
    certificateIdInputSchema,
    importCertificateInputSchema,
    replaceCertificateInputSchema,
    requestCertificateInputSchema,
} from './validation.ts'

function noStore(): void {
    setResponseHeader('Cache-Control', 'private, no-store')
}

function certificateActionFailure(
    error: unknown,
): Extract<CertificateActionResult, { success: false }> {
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

export const inspectCertificateDnsSetupHandler = createServerFn({ method: 'POST' })
    .validator(dnsSetupInputSchema)
    .handler(async ({ data }): Promise<DnsSetupActionResult> => {
        noStore()
        try {
            return { success: true, setup: await inspectCertificateDnsSetupService(data) }
        } catch (error) {
            return certificateActionFailure(error)
        }
    })

export const checkManualDnsHandler = createServerFn({ method: 'POST' })
    .validator(manualDnsCheckInputSchema)
    .handler(async ({ data }): Promise<ManualDnsCheckActionResult> => {
        noStore()
        try {
            return { success: true, check: await checkManualDnsService(data) }
        } catch (error) {
            return certificateActionFailure(error)
        }
    })

async function certificateAction(
    action: () => Promise<string | void>,
    message: string,
): Promise<CertificateActionResult> {
    noStore()
    try {
        const certificateId = await action()
        return { success: true, message, ...(certificateId ? { certificateId } : {}) }
    } catch (error) {
        return certificateActionFailure(error)
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
    .handler(async ({ data }): Promise<CertificateActionResult> => {
        noStore()
        try {
            const result = await deleteCertificateService(data.certificateId)
            return {
                success: true,
                message: result.deleted
                    ? 'admin.certificates.messages.deleted'
                    : 'admin.certificates.messages.deletePending',
                runtimeStatus: result.runtimeStatus,
            }
        } catch (error) {
            return certificateActionFailure(error)
        }
    })

export const searchCertificatesHandler = createServerFn({ method: 'GET' })
    .validator(quickSearchInputSchema)
    .handler(async ({ data }) => {
        setResponseHeader('Cache-Control', 'private, no-store')
        try {
            const actor = await requirePermissionService(PERMISSIONS.CERTIFICATES_VIEW)
            return await searchCertificatesService(actor, data)
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.certificates.errors.loadFailed')
        }
    })

export const getCertificateDnsProvidersHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        noStore()
        try {
            return await getDnsProvidersService('certificates')
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.dnsConnections.providers.unavailable')
        }
    },
)

export const getCertificateDnsConnectionsHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        noStore()
        try {
            return await getCertificateDnsConnectionsService()
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.dnsConnections.errors.controller_unavailable')
        }
    },
)

export const continueManualDnsHandler = createServerFn({ method: 'POST' })
    .validator(manualDnsActionInputSchema)
    .handler(({ data }) =>
        certificateAction(
            () => actOnManualDnsService(data, 'continue'),
            'admin.certificates.manualDns.checking',
        ),
    )
export const cancelManualDnsHandler = createServerFn({ method: 'POST' })
    .validator(manualDnsActionInputSchema)
    .handler(({ data }) =>
        certificateAction(
            () => actOnManualDnsService(data, 'cancel'),
            'admin.certificates.manualDns.cancelled',
        ),
    )

export const cancelDelegatedCertificateHandler = createServerFn({ method: 'POST' })
    .validator(cancelDelegatedCertificateInputSchema)
    .handler(({ data }) =>
        certificateAction(
            () => cancelDelegatedCertificateService(data),
            'admin.certificates.delegatedDns.cancelling',
        ),
    )

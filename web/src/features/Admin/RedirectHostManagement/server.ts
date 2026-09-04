import { createServerFn } from '@tanstack/react-start'
import { setResponseStatus } from '@tanstack/react-start/server'

import { PERMISSIONS } from '../../../config/permissions.config'
import { requirePermissionService } from '../../../server/Auth/Access/authorization.service'
import { AuthDomainError } from '../../../server/Auth/Core/errors.server'
import { CertificateDomainError } from '../../../server/Admin/CertificateManagement/certificates.errors'
import { getAssignableCertificatesService } from '../../../server/Admin/CertificateManagement/certificates.service'
import { RedirectHostDomainError } from '../../../server/Admin/RedirectHostManagement/redirect-hosts.errors'
import {
    createRedirectHostService,
    deleteRedirectHostService,
    disableRedirectHostService,
    enableRedirectHostService,
    getRedirectHostsService,
    updateRedirectHostService,
} from '../../../server/Admin/RedirectHostManagement/redirect-hosts.service'
import {
    applyProxyConfigurationService,
    getProxyRuntimeStatusService,
} from '../../../server/ProxyRuntime/proxy-runtime.service'
import type { RedirectHostActionResult } from '../../../shared/Types/redirect-hosts.types'
import {
    localizedActionFailure,
    throwLocalizedQueryError,
    type AuthActionFailureResult,
} from '../../Auth/serverHelpers'
import {
    createRedirectHostInputSchema,
    redirectHostIdInputSchema,
    updateRedirectHostInputSchema,
} from './validation'

function redirectHostActionFailure(error: unknown, fallback: string): AuthActionFailureResult {
    if (error instanceof CertificateDomainError) {
        setResponseStatus(error.code === 'controller_unavailable' ? 503 : 422)
        return { success: false, message: `admin.certificates.errors.${error.code}` }
    }
    if (error instanceof RedirectHostDomainError) {
        setResponseStatus(
            error.code === 'host_not_found' ? 404 : error.code === 'invalid_input' ? 400 : 409,
        )
        return { success: false, message: `admin.redirectHosts.errors.${error.code}` }
    }
    return localizedActionFailure(error, fallback)
}

function redirectHostActionSuccess(
    runtimeStatus: 'applied' | 'pending',
    message: string,
): RedirectHostActionResult {
    return {
        success: true,
        message: runtimeStatus === 'pending' ? 'admin.redirectHosts.runtime.savedPending' : message,
        runtimeStatus,
    }
}

export const getRedirectHostsHandler = createServerFn({ method: 'GET' }).handler(async () => {
    try {
        await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_VIEW)
        return await getRedirectHostsService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.redirectHosts.errors.loadFailed')
    }
})

export const getRedirectRuntimeStatusHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        try {
            await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_VIEW)
            return await getProxyRuntimeStatusService()
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.redirectHosts.runtime.unavailable')
        }
    },
)

export const applyRedirectConfigurationHandler = createServerFn({ method: 'POST' }).handler(
    async (): Promise<RedirectHostActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_APPLY)
            const status = await applyProxyConfigurationService()
            return status === 'applied'
                ? {
                      success: true,
                      message: 'admin.redirectHosts.runtime.applied',
                      runtimeStatus: status,
                  }
                : { success: false, message: 'admin.redirectHosts.runtime.applyFailed' }
        } catch (error) {
            return localizedActionFailure(error, 'admin.redirectHosts.runtime.applyFailed')
        }
    },
)

export const getAssignableRedirectCertificatesHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        try {
            const actor = await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_VIEW)
            if (
                !actor.permissions.includes(PERMISSIONS.REDIRECT_HOSTS_CREATE) &&
                !actor.permissions.includes(PERMISSIONS.REDIRECT_HOSTS_UPDATE)
            ) {
                throw new AuthDomainError('permission_denied', 'Permission is required.')
            }
            return await getAssignableCertificatesService()
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.redirectHosts.errors.certificatesLoadFailed')
        }
    },
)

export const createRedirectHostHandler = createServerFn({ method: 'POST' })
    .validator(createRedirectHostInputSchema)
    .handler(async ({ data }): Promise<RedirectHostActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_CREATE)
            const saved = await createRedirectHostService(data)
            return redirectHostActionSuccess(
                saved.runtimeStatus,
                'admin.redirectHosts.messages.created',
            )
        } catch (error) {
            return redirectHostActionFailure(error, 'admin.redirectHosts.errors.saveFailed')
        }
    })

export const updateRedirectHostHandler = createServerFn({ method: 'POST' })
    .validator(updateRedirectHostInputSchema)
    .handler(async ({ data }): Promise<RedirectHostActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_UPDATE)
            const saved = await updateRedirectHostService(data)
            return redirectHostActionSuccess(
                saved.runtimeStatus,
                'admin.redirectHosts.messages.updated',
            )
        } catch (error) {
            return redirectHostActionFailure(error, 'admin.redirectHosts.errors.saveFailed')
        }
    })

export const deleteRedirectHostHandler = createServerFn({ method: 'POST' })
    .validator(redirectHostIdInputSchema)
    .handler(async ({ data }): Promise<RedirectHostActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_DELETE)
            const saved = await deleteRedirectHostService(data.redirectHostId)
            return redirectHostActionSuccess(
                saved.runtimeStatus,
                'admin.redirectHosts.messages.deleted',
            )
        } catch (error) {
            return redirectHostActionFailure(error, 'admin.redirectHosts.errors.deleteFailed')
        }
    })

export const enableRedirectHostHandler = createServerFn({ method: 'POST' })
    .validator(redirectHostIdInputSchema)
    .handler(async ({ data }): Promise<RedirectHostActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_ENABLE)
            const saved = await enableRedirectHostService(data.redirectHostId)
            return redirectHostActionSuccess(
                saved.runtimeStatus,
                'admin.redirectHosts.messages.enabled',
            )
        } catch (error) {
            return redirectHostActionFailure(error, 'admin.redirectHosts.errors.enableFailed')
        }
    })

export const disableRedirectHostHandler = createServerFn({ method: 'POST' })
    .validator(redirectHostIdInputSchema)
    .handler(async ({ data }): Promise<RedirectHostActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_DISABLE)
            const saved = await disableRedirectHostService(data.redirectHostId)
            return redirectHostActionSuccess(
                saved.runtimeStatus,
                'admin.redirectHosts.messages.disabled',
            )
        } catch (error) {
            return redirectHostActionFailure(error, 'admin.redirectHosts.errors.disableFailed')
        }
    })

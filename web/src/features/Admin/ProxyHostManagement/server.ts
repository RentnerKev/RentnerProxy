import { createServerFn } from '@tanstack/react-start'
import { setResponseStatus } from '@tanstack/react-start/server'

import { PERMISSIONS } from '../../../config/permissions.config'
import { requirePermissionService } from '../../../server/Auth/Access/authorization.service'
import { ProxyHostDomainError } from '../../../server/Admin/ProxyHostManagement/proxy-hosts.errors'
import {
    createProxyHostService,
    deleteProxyHostService,
    disableProxyHostService,
    enableProxyHostService,
    getProxyHostsService,
    updateProxyHostService,
} from '../../../server/Admin/ProxyHostManagement/proxy-hosts.service'
import {
    localizedActionFailure,
    throwLocalizedQueryError,
    type AuthActionResult,
} from '../../Auth/serverHelpers'
import {
    createProxyHostInputSchema,
    proxyHostIdInputSchema,
    updateProxyHostInputSchema,
} from './validation'

function proxyHostActionFailure(error: unknown, fallback: string): AuthActionResult {
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

    return localizedActionFailure(error, fallback)
}

export const getProxyHostsHandler = createServerFn({ method: 'GET' }).handler(async () => {
    try {
        await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
        return await getProxyHostsService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.proxyHosts.errors.loadFailed')
    }
})

export const createProxyHostHandler = createServerFn({ method: 'POST' })
    .validator(createProxyHostInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.PROXY_HOSTS_CREATE)
            await createProxyHostService(data)
            return { success: true, message: 'admin.proxyHosts.messages.created' }
        } catch (error) {
            return proxyHostActionFailure(error, 'admin.proxyHosts.errors.saveFailed')
        }
    })

export const updateProxyHostHandler = createServerFn({ method: 'POST' })
    .validator(updateProxyHostInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
            await updateProxyHostService(data)
            return { success: true, message: 'admin.proxyHosts.messages.updated' }
        } catch (error) {
            return proxyHostActionFailure(error, 'admin.proxyHosts.errors.saveFailed')
        }
    })

export const deleteProxyHostHandler = createServerFn({ method: 'POST' })
    .validator(proxyHostIdInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.PROXY_HOSTS_DELETE)
            await deleteProxyHostService(data.proxyHostId)
            return { success: true, message: 'admin.proxyHosts.messages.deleted' }
        } catch (error) {
            return proxyHostActionFailure(error, 'admin.proxyHosts.errors.deleteFailed')
        }
    })

export const enableProxyHostHandler = createServerFn({ method: 'POST' })
    .validator(proxyHostIdInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.PROXY_HOSTS_ENABLE)
            await enableProxyHostService(data.proxyHostId)
            return { success: true, message: 'admin.proxyHosts.messages.enabled' }
        } catch (error) {
            return proxyHostActionFailure(error, 'admin.proxyHosts.errors.enableFailed')
        }
    })

export const disableProxyHostHandler = createServerFn({ method: 'POST' })
    .validator(proxyHostIdInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.PROXY_HOSTS_DISABLE)
            await disableProxyHostService(data.proxyHostId)
            return { success: true, message: 'admin.proxyHosts.messages.disabled' }
        } catch (error) {
            return proxyHostActionFailure(error, 'admin.proxyHosts.errors.disableFailed')
        }
    })

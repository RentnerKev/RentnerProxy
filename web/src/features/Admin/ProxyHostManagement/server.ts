import { createServerFn } from '@tanstack/react-start'
import { setResponseStatus } from '@tanstack/react-start/server'

import { PERMISSIONS } from '../../../config/permissions.config'
import type {
    ProxyHostActionResult,
    ProxyRuntimeMutationStatus,
} from '../../../shared/Types/proxy-runtime.types'
import {
    applyProxyConfigurationService,
    getProxyRuntimeStatusService,
} from '../../../server/ProxyRuntime/proxy-runtime.service'
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
    type AuthActionFailureResult,
} from '../../Auth/serverHelpers'
import {
    createProxyHostInputSchema,
    proxyHostIdInputSchema,
    updateProxyHostInputSchema,
} from './validation'

function proxyHostActionFailure(error: unknown, fallback: string): AuthActionFailureResult {
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

function proxyHostActionSuccess(
    runtimeStatus: ProxyRuntimeMutationStatus,
    appliedMessage: string,
): ProxyHostActionResult {
    return {
        success: true,
        message:
            runtimeStatus === 'pending' ? 'admin.proxyHosts.runtime.savedPending' : appliedMessage,
        runtimeStatus,
    }
}

export const getProxyRuntimeStatusHandler = createServerFn({ method: 'GET' }).handler(async () => {
    try {
        await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
        return await getProxyRuntimeStatusService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.proxyHosts.runtime.unavailable')
    }
})

export const applyProxyConfigurationHandler = createServerFn({ method: 'POST' }).handler(
    async (): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
            const status = await applyProxyConfigurationService()

            return status === 'applied'
                ? { success: true, message: 'admin.proxyHosts.runtime.applied' }
                : { success: false, message: 'admin.proxyHosts.runtime.applyFailed' }
        } catch (error) {
            return localizedActionFailure(error, 'admin.proxyHosts.runtime.applyFailed')
        }
    },
)

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
    .handler(async ({ data }): Promise<ProxyHostActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.PROXY_HOSTS_CREATE)
            const saved = await createProxyHostService(data)
            return proxyHostActionSuccess(saved.runtimeStatus, 'admin.proxyHosts.messages.created')
        } catch (error) {
            return proxyHostActionFailure(error, 'admin.proxyHosts.errors.saveFailed')
        }
    })

export const updateProxyHostHandler = createServerFn({ method: 'POST' })
    .validator(updateProxyHostInputSchema)
    .handler(async ({ data }): Promise<ProxyHostActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
            const saved = await updateProxyHostService(data)
            return proxyHostActionSuccess(saved.runtimeStatus, 'admin.proxyHosts.messages.updated')
        } catch (error) {
            return proxyHostActionFailure(error, 'admin.proxyHosts.errors.saveFailed')
        }
    })

export const deleteProxyHostHandler = createServerFn({ method: 'POST' })
    .validator(proxyHostIdInputSchema)
    .handler(async ({ data }): Promise<ProxyHostActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.PROXY_HOSTS_DELETE)
            const saved = await deleteProxyHostService(data.proxyHostId)
            return proxyHostActionSuccess(saved.runtimeStatus, 'admin.proxyHosts.messages.deleted')
        } catch (error) {
            return proxyHostActionFailure(error, 'admin.proxyHosts.errors.deleteFailed')
        }
    })

export const enableProxyHostHandler = createServerFn({ method: 'POST' })
    .validator(proxyHostIdInputSchema)
    .handler(async ({ data }): Promise<ProxyHostActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.PROXY_HOSTS_ENABLE)
            const saved = await enableProxyHostService(data.proxyHostId)
            return proxyHostActionSuccess(saved.runtimeStatus, 'admin.proxyHosts.messages.enabled')
        } catch (error) {
            return proxyHostActionFailure(error, 'admin.proxyHosts.errors.enableFailed')
        }
    })

export const disableProxyHostHandler = createServerFn({ method: 'POST' })
    .validator(proxyHostIdInputSchema)
    .handler(async ({ data }): Promise<ProxyHostActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.PROXY_HOSTS_DISABLE)
            const saved = await disableProxyHostService(data.proxyHostId)
            return proxyHostActionSuccess(saved.runtimeStatus, 'admin.proxyHosts.messages.disabled')
        } catch (error) {
            return proxyHostActionFailure(error, 'admin.proxyHosts.errors.disableFailed')
        }
    })

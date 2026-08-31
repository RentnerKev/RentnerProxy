import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import { z } from 'zod'

import {
    getProxyHostConfigEditorService,
    previewProxyHostConfigEditorService,
    saveProxyHostConfigEditorService,
    resetProxyHostConfigEditorService,
} from '../../../server/ProxyRuntime/proxy-host-config-editor.service'
import {
    proxyHostConfigEditorIdSchema,
    proxyHostConfigEditorPreviewSchema,
    proxyHostConfigEditorSaveSchema,
    proxyHostConfigEditorResetSchema,
} from './config-validation'

import { PERMISSIONS } from '../../../config/permissions.config'
import { MAX_PROXY_SETTINGS_SOURCE_LENGTH } from '../../../config/proxy-http.config'
import {
    getProxyConfigEditorService,
    previewProxyConfigEditorService,
    resetProxyConfigEditorService,
    saveProxyConfigEditorService,
    ProxyConfigEditorError,
} from '../../../server/ProxyRuntime/proxy-config-editor.service'
import {
    ProxyHttpSettingsParseError,
    proxyConfigEditorSaveSchema,
    proxyConfigEditorResetSchema,
} from './config-validation'
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
import { CertificateDomainError } from '../../../server/Admin/CertificateManagement/certificates.errors'
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

function noStore(): void {
    setResponseHeader('Cache-Control', 'private, no-store')
}

function configActionFailure(error: unknown): AuthActionFailureResult {
    if (error instanceof ProxyConfigEditorError) {
        setResponseStatus(
            error.code === 'configuration_conflict'
                ? 409
                : error.code === 'host_not_found'
                  ? 404
                  : 503,
        )
        return { success: false, message: `admin.proxyHosts.config.errors.${error.code}` }
    }
    if (error instanceof ProxyHttpSettingsParseError) {
        setResponseStatus(422)
        return { success: false, message: 'admin.proxyHosts.config.errors.invalidSettings' }
    }
    return localizedActionFailure(error, 'admin.proxyHosts.config.errors.saveFailed')
}

export const getProxyConfigEditorHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return await getProxyConfigEditorService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.proxyHosts.config.errors.loadFailed')
    }
})

export const previewProxyConfigEditorHandler = createServerFn({ method: 'POST' })
    .validator(z.strictObject({ settingsSource: z.string().max(MAX_PROXY_SETTINGS_SOURCE_LENGTH) }))
    .handler(async ({ data }) => {
        noStore()
        try {
            return await previewProxyConfigEditorService(data.settingsSource)
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.proxyHosts.config.errors.previewFailed')
        }
    })

export const saveProxyConfigEditorHandler = createServerFn({ method: 'POST' })
    .validator(proxyConfigEditorSaveSchema)
    .handler(async ({ data }): Promise<ProxyHostActionResult> => {
        noStore()
        try {
            const runtimeStatus = await saveProxyConfigEditorService(data)
            return {
                success: true,
                runtimeStatus,
                message:
                    runtimeStatus === 'applied'
                        ? 'admin.proxyHosts.config.saved'
                        : 'admin.proxyHosts.runtime.savedPending',
            }
        } catch (error) {
            return configActionFailure(error)
        }
    })

export const resetProxyConfigEditorHandler = createServerFn({ method: 'POST' })
    .validator(proxyConfigEditorResetSchema)
    .handler(async ({ data }): Promise<ProxyHostActionResult> => {
        noStore()
        try {
            const runtimeStatus = await resetProxyConfigEditorService(data)
            return {
                success: true,
                runtimeStatus,
                message:
                    runtimeStatus === 'applied'
                        ? 'admin.proxyHosts.config.reset'
                        : 'admin.proxyHosts.runtime.savedPending',
            }
        } catch (error) {
            return configActionFailure(error)
        }
    })

export const getProxyHostConfigEditorHandler = createServerFn({ method: 'GET' })
    .validator(proxyHostConfigEditorIdSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            return await getProxyHostConfigEditorService(data.proxyHostId)
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.proxyHosts.config.errors.loadFailed')
        }
    })

export const previewProxyHostConfigEditorHandler = createServerFn({ method: 'POST' })
    .validator(proxyHostConfigEditorPreviewSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            return await previewProxyHostConfigEditorService(data)
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.proxyHosts.config.errors.previewFailed')
        }
    })

function hostConfigSuccess(
    result: { readonly enabled: boolean; readonly runtimeStatus: ProxyRuntimeMutationStatus },
    message: string,
    advancedChanged = false,
): ProxyHostActionResult {
    return {
        success: true,
        runtimeStatus: result.runtimeStatus,
        message:
            result.runtimeStatus === 'pending'
                ? advancedChanged
                    ? 'admin.proxyHosts.config.advanced.savedPending'
                    : 'admin.proxyHosts.runtime.savedPending'
                : result.enabled
                  ? message
                  : 'admin.proxyHosts.config.hostSavedDisabled',
    }
}

export const saveProxyHostConfigEditorHandler = createServerFn({ method: 'POST' })
    .validator(proxyHostConfigEditorSaveSchema)
    .handler(async ({ data }): Promise<ProxyHostActionResult> => {
        noStore()
        try {
            return hostConfigSuccess(
                await saveProxyHostConfigEditorService(data),
                'admin.proxyHosts.config.hostSaved',
                data.advancedConfig !== undefined,
            )
        } catch (error) {
            return configActionFailure(error)
        }
    })

export const resetProxyHostConfigEditorHandler = createServerFn({ method: 'POST' })
    .validator(proxyHostConfigEditorResetSchema)
    .handler(async ({ data }): Promise<ProxyHostActionResult> => {
        noStore()
        try {
            return hostConfigSuccess(
                await resetProxyHostConfigEditorService(data),
                'admin.proxyHosts.config.hostReset',
                data.resetAdvancedConfig === true,
            )
        } catch (error) {
            return configActionFailure(error)
        }
    })

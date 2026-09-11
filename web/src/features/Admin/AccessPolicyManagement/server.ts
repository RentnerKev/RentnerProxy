import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'

import { PERMISSIONS } from '../../../config/permissions.config'
import {
    applyProxyConfigurationService,
    getProxyRuntimeStatusService,
} from '../../../server/ProxyRuntime/proxy-runtime.service'
import {
    createAccessPolicyService,
    deleteAccessPolicyService,
    getAccessPoliciesService,
    getAssignableAccessPoliciesService,
    updateAccessPolicyService,
} from '../../../server/Admin/AccessPolicyManagement/access-policies.service'
import { AccessPolicyDomainError } from '../../../server/Admin/AccessPolicyManagement/access-policies.errors'
import { BasicAuthDomainError } from '../../../server/Admin/AccessPolicyManagement/basic-auth.errors'
import {
    createBasicAuthAccountService,
    deleteBasicAuthAccountService,
    getBasicAuthAccountsService,
    updateBasicAuthAccountService,
} from '../../../server/Admin/AccessPolicyManagement/basic-auth.service'
import { requirePermissionService } from '../../../server/Auth/Access/authorization.service'
import { localizedActionFailure, throwLocalizedQueryError } from '../../Auth/serverHelpers'
import {
    accessPolicyIdInputSchema,
    createAccessPolicyInputSchema,
    updateAccessPolicyInputSchema,
} from './validation'
import {
    basicAuthAccountsPolicyInputSchema,
    createBasicAuthAccountInputSchema,
    deleteBasicAuthAccountInputSchema,
    updateBasicAuthAccountInputSchema,
} from './basic-auth.validation'

function noStore(): void {
    setResponseHeader('Cache-Control', 'private, no-store')
}

function actionFailure(error: unknown, fallback: string) {
    if (error instanceof AccessPolicyDomainError) {
        setResponseStatus(
            error.code === 'access_policy_not_found'
                ? 404
                : error.code === 'access_policy_in_use'
                  ? 409
                  : error.code === 'controller_unavailable'
                    ? 503
                    : 400,
        )
        return { success: false as const, message: `admin.accessPolicies.errors.${error.code}` }
    }
    return localizedActionFailure(error, fallback)
}

export const getAccessPoliciesHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return await getAccessPoliciesService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.accessPolicies.errors.loadFailed')
    }
})

export const getAssignableAccessPoliciesHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        noStore()
        try {
            return await getAssignableAccessPoliciesService()
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.accessPolicies.errors.loadFailed')
        }
    },
)

export const createAccessPolicyHandler = createServerFn({ method: 'POST' })
    .validator(createAccessPolicyInputSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            const result = await createAccessPolicyService(data)
            return {
                success: true as const,
                message:
                    result.runtimeStatus === 'pending'
                        ? 'admin.accessPolicies.messages.savedPending'
                        : 'admin.accessPolicies.messages.created',
                ...result,
            }
        } catch (error) {
            return actionFailure(error, 'admin.accessPolicies.errors.saveFailed')
        }
    })

export const updateAccessPolicyHandler = createServerFn({ method: 'POST' })
    .validator(updateAccessPolicyInputSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            const result = await updateAccessPolicyService(data)
            return {
                success: true as const,
                message:
                    result.runtimeStatus === 'pending'
                        ? 'admin.accessPolicies.messages.savedPending'
                        : 'admin.accessPolicies.messages.updated',
                ...result,
            }
        } catch (error) {
            return actionFailure(error, 'admin.accessPolicies.errors.saveFailed')
        }
    })

export const deleteAccessPolicyHandler = createServerFn({ method: 'POST' })
    .validator(accessPolicyIdInputSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            const result = await deleteAccessPolicyService(data.accessPolicyId)
            return {
                success: true as const,
                message:
                    result.runtimeStatus === 'pending'
                        ? 'admin.accessPolicies.messages.savedPending'
                        : 'admin.accessPolicies.messages.deleted',
                ...result,
            }
        } catch (error) {
            return actionFailure(error, 'admin.accessPolicies.errors.deleteFailed')
        }
    })

export const getAccessPolicyRuntimeStatusHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        noStore()
        try {
            return await getProxyRuntimeStatusService(PERMISSIONS.ACCESS_POLICIES_VIEW)
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.accessPolicies.errors.runtimeUnavailable')
        }
    },
)

export const applyAccessPolicyConfigurationHandler = createServerFn({ method: 'POST' }).handler(
    async () => {
        noStore()
        try {
            await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_APPLY)
            const status = await applyProxyConfigurationService(PERMISSIONS.ACCESS_POLICIES_APPLY)
            return status === 'applied'
                ? { success: true as const, message: 'admin.accessPolicies.messages.applied' }
                : { success: false as const, message: 'admin.accessPolicies.errors.applyFailed' }
        } catch (error) {
            return actionFailure(error, 'admin.accessPolicies.errors.applyFailed')
        }
    },
)

function basicAuthActionFailure(error: unknown, fallback: string) {
    if (error instanceof BasicAuthDomainError) {
        setResponseStatus(
            error.code === 'basic_auth_account_not_found'
                ? 404
                : error.code === 'basic_auth_username_conflict' ||
                    error.code === 'basic_auth_account_limit'
                  ? 409
                  : 422,
        )
        return {
            success: false as const,
            message: `admin.accessPolicies.basicAuth.errors.${error.code}`,
        }
    }
    if (error instanceof AccessPolicyDomainError) {
        setResponseStatus(error.code === 'access_policy_not_found' ? 404 : 422)
        return { success: false as const, message: `admin.accessPolicies.errors.${error.code}` }
    }
    return localizedActionFailure(error, fallback)
}

export const getBasicAuthAccountsHandler = createServerFn({ method: 'GET' })
    .validator(basicAuthAccountsPolicyInputSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            return await getBasicAuthAccountsService(data)
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.accessPolicies.basicAuth.errors.loadFailed')
        }
    })

export const createBasicAuthAccountHandler = createServerFn({ method: 'POST' })
    .validator(createBasicAuthAccountInputSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            const result = await createBasicAuthAccountService(data)
            return {
                success: true as const,
                message:
                    result.runtimeStatus === 'pending'
                        ? 'admin.accessPolicies.basicAuth.messages.savedPending'
                        : 'admin.accessPolicies.basicAuth.messages.created',
                ...result,
            }
        } catch (error) {
            return basicAuthActionFailure(error, 'admin.accessPolicies.basicAuth.errors.saveFailed')
        }
    })

export const updateBasicAuthAccountHandler = createServerFn({ method: 'POST' })
    .validator(updateBasicAuthAccountInputSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            const result = await updateBasicAuthAccountService(data)
            return {
                success: true as const,
                message:
                    result.runtimeStatus === 'pending'
                        ? 'admin.accessPolicies.basicAuth.messages.savedPending'
                        : 'admin.accessPolicies.basicAuth.messages.updated',
                ...result,
            }
        } catch (error) {
            return basicAuthActionFailure(error, 'admin.accessPolicies.basicAuth.errors.saveFailed')
        }
    })

export const deleteBasicAuthAccountHandler = createServerFn({ method: 'POST' })
    .validator(deleteBasicAuthAccountInputSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            const result = await deleteBasicAuthAccountService(data)
            return {
                success: true as const,
                message:
                    result.runtimeStatus === 'pending'
                        ? 'admin.accessPolicies.basicAuth.messages.savedPending'
                        : 'admin.accessPolicies.basicAuth.messages.deleted',
                ...result,
            }
        } catch (error) {
            return basicAuthActionFailure(
                error,
                'admin.accessPolicies.basicAuth.errors.deleteFailed',
            )
        }
    })

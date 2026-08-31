import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'

import { TrustedCaDomainError } from '../../../server/Admin/TrustedCaManagement/trusted-cas.errors'
import {
    createTrustedCaService,
    deleteTrustedCaService,
    getAssignableTrustedCasService,
    getTrustedCasService,
    replaceTrustedCaService,
} from '../../../server/Admin/TrustedCaManagement/trusted-cas.service'
import { localizedActionFailure, throwLocalizedQueryError } from '../../Auth/serverHelpers'
import {
    createTrustedCaInputSchema,
    replaceTrustedCaInputSchema,
    trustedCaIdInputSchema,
} from './validation'

function noStore(): void {
    setResponseHeader('Cache-Control', 'private, no-store')
}

const trustedCaErrorMessages = {
    invalid_input: 'admin.trustedCas.errors.invalidInput',
    trusted_ca_not_found: 'admin.trustedCas.errors.notFound',
    trusted_ca_duplicate: 'admin.trustedCas.errors.duplicate',
    trusted_ca_in_use: 'admin.trustedCas.errors.inUse',
    controller_unavailable: 'admin.trustedCas.errors.controllerUnavailable',
} as const
function trustedCaActionFailure(error: unknown): {
    readonly success: false
    readonly message: string
} {
    if (error instanceof TrustedCaDomainError) {
        setResponseStatus(
            error.code === 'trusted_ca_not_found'
                ? 404
                : error.code === 'trusted_ca_duplicate' || error.code === 'trusted_ca_in_use'
                  ? 409
                  : error.code === 'controller_unavailable'
                    ? 503
                    : 422,
        )
        return { success: false, message: trustedCaErrorMessages[error.code] }
    }
    return localizedActionFailure(error, 'admin.trustedCas.errors.saveFailed')
}

export const getTrustedCasHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return await getTrustedCasService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.trustedCas.errors.loadFailed')
    }
})

export const getAssignableTrustedCasHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        noStore()
        try {
            return await getAssignableTrustedCasService()
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.trustedCas.errors.loadFailed')
        }
    },
)

export const createTrustedCaHandler = createServerFn({ method: 'POST' })
    .validator(createTrustedCaInputSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            const result = await createTrustedCaService(data)
            return {
                success: true as const,
                message:
                    result.runtimeStatus === 'pending'
                        ? 'admin.trustedCas.messages.savedPending'
                        : 'admin.trustedCas.messages.created',
                ...result,
            }
        } catch (error) {
            return trustedCaActionFailure(error)
        }
    })

export const replaceTrustedCaHandler = createServerFn({ method: 'POST' })
    .validator(replaceTrustedCaInputSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            const result = await replaceTrustedCaService(data)
            return {
                success: true as const,
                message:
                    result.runtimeStatus === 'pending'
                        ? 'admin.trustedCas.messages.savedPending'
                        : 'admin.trustedCas.messages.replaced',
                ...result,
            }
        } catch (error) {
            return trustedCaActionFailure(error)
        }
    })

export const deleteTrustedCaHandler = createServerFn({ method: 'POST' })
    .validator(trustedCaIdInputSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            const result = await deleteTrustedCaService(data.trustedCaId)
            return {
                success: true as const,
                message:
                    result.runtimeStatus === 'pending'
                        ? 'admin.trustedCas.messages.savedPending'
                        : 'admin.trustedCas.messages.deleted',
                ...result,
            }
        } catch (error) {
            return trustedCaActionFailure(error)
        }
    })

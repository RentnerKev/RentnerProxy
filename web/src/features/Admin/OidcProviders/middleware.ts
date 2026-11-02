import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import { saveOidcProvidersSchema } from './validation.ts'
import {
    getOidcProvidersService,
    saveOidcProvidersService,
} from '@/server/Auth/Oidc/oidc-providers.service.ts'
import { OidcDomainError } from '@/server/Auth/Oidc/oidc.errors.ts'
import { localizedActionFailure, throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'

function noStore() {
    setResponseHeader('Cache-Control', 'private, no-store')
}

export const getOidcProvidersHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return await getOidcProvidersService()
    } catch (error) {
        throwLocalizedQueryError(error)
    }
})

export const saveOidcProvidersHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => {
        noStore()
        const parsed = saveOidcProvidersSchema.safeParse(input)
        if (!parsed.success) {
            setResponseStatus(422)
            throw new Error('errors.invalid_input')
        }
        return parsed.data
    })
    .handler(async ({ data }) => {
        noStore()
        try {
            return { success: true as const, value: await saveOidcProvidersService(data) }
        } catch (error) {
            if (error instanceof OidcDomainError) {
                setResponseStatus(
                    error.code === 'configuration_conflict'
                        ? 409
                        : error.code === 'invalid_input' || error.code === 'identity_not_allowed'
                          ? 422
                          : 503,
                )
                return {
                    success: false as const,
                    code: error.code,
                    message:
                        error.code === 'invalid_input' || error.code === 'identity_not_allowed'
                            ? 'errors.invalid_input'
                            : 'common.requestFailed',
                }
            }
            return localizedActionFailure(error, 'common.requestFailed')
        }
    })

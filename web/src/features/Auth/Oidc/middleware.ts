import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { getPublicOidcProvidersService } from '@/server/Auth/Oidc/oidc-providers.service.ts'

export const getPublicOidcProvidersHandler = createServerFn({ method: 'GET' }).handler(async () => {
    setResponseHeader('Cache-Control', 'private, no-store')
    try {
        return await getPublicOidcProvidersService()
    } catch {
        return []
    }
})

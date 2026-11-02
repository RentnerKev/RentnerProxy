import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

export const getPublicOidcProvidersHandler = createServerFn({ method: 'GET' }).handler(async () => {
    setResponseHeader('Cache-Control', 'private, no-store')
    const { getPublicOidcCatalogService } =
        await import('@/server/Auth/Oidc/oidc-public-catalog.server.ts')
    return getPublicOidcCatalogService()
})

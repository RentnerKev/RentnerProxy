import '@tanstack/react-start/server-only'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { getPublicOidcProvidersService } from './oidc-providers.service.ts'
import type {
    OidcPublicCatalogDependencies,
    PublicOidcCatalogEntry,
} from './Types/oidc-public-catalog.types.ts'

/** Coalesces public display reads and briefly caches sanitized successes or outage fallbacks. */
export function createOidcPublicCatalogCache(dependencies: OidcPublicCatalogDependencies) {
    let cached: readonly PublicOidcCatalogEntry[] | undefined
    let expiresAt = 0
    let inFlight: Promise<readonly PublicOidcCatalogEntry[]> | undefined

    /** Returns isolated IDs/names without caching or deciding any authentication policy. */
    return async function getPublicOidcCatalogService(): Promise<
        Array<{ id: string; name: string }>
    > {
        if (!cached || dependencies.now() >= expiresAt) {
            inFlight ??= Promise.resolve().then(async () => {
                let entries: readonly PublicOidcCatalogEntry[]
                try {
                    entries = (await dependencies.load()).map(({ id, name }) => ({ id, name }))
                } catch {
                    entries = []
                    try {
                        dependencies.report('provider_catalog_unavailable')
                    } catch {
                        // A failed diagnostic sink must not defeat the bounded outage fallback.
                    }
                }
                cached = entries
                expiresAt = dependencies.now() + OIDC_LIMITS.publicCatalogCacheMs
                inFlight = undefined
                return entries
            })
            const entries = await inFlight
            return entries.map(({ id, name }) => ({ id, name }))
        }
        return cached.map(({ id, name }) => ({ id, name }))
    }
}

/** Process-local public display cache; start and callback retain fresh authoritative service reads. */
export const getPublicOidcCatalogService = createOidcPublicCatalogCache({
    load: getPublicOidcProvidersService,
    now: Date.now,
    report: (code) => console.warn(code),
})

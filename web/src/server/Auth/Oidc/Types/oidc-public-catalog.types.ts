/** Credential-free display metadata; authentication policy is always read separately. */
export interface PublicOidcCatalogEntry {
    readonly id: string
    readonly name: string
}

/** Supplies catalog loading, bounded diagnostics and a clock for the process-local cache. */
export interface OidcPublicCatalogDependencies {
    readonly load: () => Promise<readonly PublicOidcCatalogEntry[]>
    readonly now: () => number
    readonly report: (code: 'provider_catalog_unavailable') => void
}

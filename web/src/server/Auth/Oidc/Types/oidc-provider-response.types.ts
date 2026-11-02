import type {
    OidcProvidersSummary,
    SaveOidcProvidersInput,
} from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'

export interface OidcProviderResponseDependencies {
    readonly origin: () => string | null
    readonly get: () => Promise<OidcProvidersSummary>
    readonly save: (input: SaveOidcProvidersInput) => Promise<OidcProvidersSummary>
}

import type {
    getOidcConnectionsService,
    unlinkOidcConnectionService,
} from '../oidc-linking.service.ts'

export interface OidcConnectionsResponseDependencies {
    readonly origin: () => string | null
    readonly get: typeof getOidcConnectionsService
    readonly unlink: typeof unlinkOidcConnectionService
}

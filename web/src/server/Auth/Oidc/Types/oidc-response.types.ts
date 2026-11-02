import type {
    beginOidcLoginService,
    beginOidcLinkService,
    completeOidcLoginService,
} from '../oidc-login.service.ts'

export interface OidcHttpHandlerDependencies {
    readonly origin: () => string | null
    readonly begin: typeof beginOidcLoginService
    readonly beginLink?: typeof beginOidcLinkService
    readonly complete: typeof completeOidcLoginService
    readonly limit: () => Promise<void>
    readonly signedIn: () => Promise<boolean>
}

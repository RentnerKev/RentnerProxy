import type { beginOidcLoginService, completeOidcLoginService } from '../oidc-login.service.ts'

export interface OidcHttpHandlerDependencies {
    readonly origin: () => string | null
    readonly begin: typeof beginOidcLoginService
    readonly complete: typeof completeOidcLoginService
    readonly limit: () => Promise<void>
    readonly signedIn: () => Promise<boolean>
}

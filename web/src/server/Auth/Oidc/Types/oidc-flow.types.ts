import type { LoginResult } from '@/server/Auth/Core/Types/auth-service.types.ts'
import type { ValkeyCommandClient } from '@/server/Valkey/Types/valkey.types.ts'
import type {
    OidcAuthorizationRequest,
    OidcClientConfiguration,
    OidcVerifiedIdentity,
} from './oidc.types.ts'

export interface OidcFlow {
    readonly providerId: string
    readonly providerRevision: number
    readonly issuer: string
    readonly redirectUri: string
    readonly nonce: string
    readonly codeVerifier: string
    readonly link?: OidcLinkTarget | undefined
}

export interface OidcLinkTarget {
    readonly userId: string
    readonly sessionId: string
    readonly expectedRevision: number
}

export type OidcFlowCompletion = LoginResult | { readonly success: true; readonly linked: true }

export interface OidcFlowStore {
    issue(flow: OidcFlow): Promise<{ state: string; browserToken: string; expiresAt: Date }>
    consume(state: string, browserToken: string): Promise<OidcFlow | null>
}

export interface OidcStateDependencies {
    readonly client: () => ValkeyCommandClient | null
    readonly now: () => number
    readonly seal: (
        plaintext: string,
        context: string,
    ) => Promise<{ ciphertext: Uint8Array; iv: Uint8Array }>
    readonly open: (
        encrypted: { ciphertext: Uint8Array; iv: Uint8Array },
        context: string,
    ) => Promise<string>
}

export interface OidcFlowDependencies {
    readonly origin: () => string | null
    readonly configuration: (id: string) => Promise<OidcClientConfiguration>
    readonly state: OidcFlowStore
    readonly protocol: {
        buildAuthorizationUrl(
            configuration: OidcClientConfiguration,
            request: OidcAuthorizationRequest,
        ): Promise<URL>
        exchangeAuthorizationCode(
            configuration: OidcClientConfiguration,
            request: OidcAuthorizationRequest,
            callbackUrl: URL,
        ): Promise<OidcVerifiedIdentity>
    }
    readonly authenticate: (
        configuration: OidcClientConfiguration,
        identity: OidcVerifiedIdentity,
    ) => Promise<LoginResult>
    readonly link?: (
        configuration: OidcClientConfiguration,
        identity: OidcVerifiedIdentity,
        target: OidcLinkTarget,
    ) => Promise<void>
    readonly failed: () => Promise<void>
}

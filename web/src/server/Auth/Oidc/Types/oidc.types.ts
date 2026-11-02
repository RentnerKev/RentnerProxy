export interface OidcClientConfiguration {
    readonly providerId: string
    readonly revision: number
    readonly issuer: string
    readonly clientId: string
    readonly clientSecret: string
    readonly tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
    readonly allowedEndpointOrigins: readonly string[]
    readonly allowedPrivateCidrs: readonly string[]
}

export interface OidcIdentityProof {
    readonly providerId: string
    readonly providerRevision: number
    readonly issuer: string
    readonly subject: string
    readonly userId: string
}

export interface OidcAuthorizationRequest {
    readonly redirectUri: string
    readonly state: string
    readonly nonce: string
    readonly codeVerifier: string
}

export interface OidcVerifiedIdentity {
    readonly issuer: string
    readonly subject: string
}

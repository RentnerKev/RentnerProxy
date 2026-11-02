import type { OidcSessionProof } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'

export interface OidcClientConfiguration {
    readonly providerId: string
    readonly revision: number
    readonly issuer: string
    readonly clientId: string
    readonly clientSecret: string
    readonly tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
    readonly allowedEndpointOrigins: readonly string[]
    readonly allowedPrivateCidrs: readonly string[]
    readonly groupClaim?: string
}

export interface OidcIdentityProof extends OidcSessionProof {
    readonly groups?: readonly string[]
}

export interface OidcAuthorizationRequest {
    readonly redirectUri: string
    readonly state: string
    readonly nonce: string
    readonly codeVerifier: string
    readonly prompt?: 'login'
}

export interface OidcVerifiedIdentity {
    readonly issuer: string
    readonly subject: string
    readonly expiresAt: number
    readonly groups?: readonly string[]
    readonly email?: string
    readonly emailVerified?: boolean
    readonly displayName?: string
}

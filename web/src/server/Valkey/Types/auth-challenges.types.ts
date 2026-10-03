import type { ValkeyCommandClient } from './valkey.types.ts'

export type AuthChallengeKind =
    | 'login-mfa'
    | 'totp-setup'
    | 'webauthn-authentication'
    | 'webauthn-reauthentication'
    | 'webauthn-registration'

export interface BaseChallenge {
    readonly createdAt: string
    readonly kind: AuthChallengeKind
}

export interface LoginMfaChallenge extends BaseChallenge {
    readonly attempts: number
    readonly kind: 'login-mfa'
    readonly userId: string
}

export interface TotpSetupChallenge extends BaseChallenge {
    readonly attempts: number
    readonly ciphertext: string
    readonly iv: string
    readonly kind: 'totp-setup'
    readonly sessionId: string
    readonly userId: string
}

export interface WebAuthnRegistrationChallenge extends BaseChallenge {
    readonly challenge: string
    readonly kind: 'webauthn-registration'
    readonly sessionId: string
    readonly userId: string
}

export interface WebAuthnAuthenticationChallenge extends BaseChallenge {
    readonly challenge: string
    readonly kind: 'webauthn-authentication'
}

export interface WebAuthnReauthenticationChallenge extends BaseChallenge {
    readonly challenge: string
    readonly kind: 'webauthn-reauthentication'
    readonly sessionId: string
    readonly userId: string
}

export type AuthChallenge =
    | LoginMfaChallenge
    | TotpSetupChallenge
    | WebAuthnAuthenticationChallenge
    | WebAuthnReauthenticationChallenge
    | WebAuthnRegistrationChallenge

export interface IssuedAuthChallenge {
    readonly expiresAt: Date
    readonly id: string
}

export interface CodeChallengeVerification<TChallenge extends AuthChallenge> {
    readonly challenge: TChallenge
    readonly id: string
    readonly lockToken: string
}

export interface AuthChallengeDependencies {
    readonly getClient: () => ValkeyCommandClient | null
}

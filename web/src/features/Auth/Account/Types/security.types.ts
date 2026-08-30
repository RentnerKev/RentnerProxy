import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'

export interface SecurityPasskey {
    readonly id: string
    readonly name: string
    readonly createdAt: string
    readonly lastUsedAt: string | null
}

export interface SecurityStatus {
    readonly totpEnabled: boolean
    readonly recoveryCodesRemaining: number
    readonly passkeys: ReadonlyArray<SecurityPasskey>
    readonly recentlyAuthenticated: boolean
}

export interface SecurityActionResult {
    readonly success: boolean
    readonly message: string
}

export interface TotpSetupFormValues {
    readonly code: string
}

export type SerializedAuthenticationResponse = AuthenticationResponseJSON
export type SerializedRegistrationResponse = RegistrationResponseJSON

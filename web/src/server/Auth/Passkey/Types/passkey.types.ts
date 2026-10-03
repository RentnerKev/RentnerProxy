import type {
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server'

export interface PasskeySummary {
    readonly createdAt: Date
    readonly id: string
    readonly lastUsedAt: Date | null
    readonly name: string
}

export type PasskeyAuthenticationResult =
    | {
          readonly code: 'authentication_failed' | 'challenge_expired'
          readonly success: false
      }
    | {
          readonly session: {
              readonly expiresAt: Date
              readonly id: string
              readonly token: string
          }
          readonly success: true
      }

export interface SerializableWebAuthnExtensions {
    readonly appid?: string
    readonly credProps?: boolean
    readonly hmacCreateSecret?: boolean
    readonly minPinLength?: boolean
}

export type SerializablePasskeyRegistrationOptions = Omit<
    PublicKeyCredentialCreationOptionsJSON,
    'extensions'
> & {
    readonly extensions?: SerializableWebAuthnExtensions
}

export type SerializablePasskeyAuthenticationOptions = Omit<
    PublicKeyCredentialRequestOptionsJSON,
    'extensions'
> & {
    readonly extensions?: SerializableWebAuthnExtensions
}

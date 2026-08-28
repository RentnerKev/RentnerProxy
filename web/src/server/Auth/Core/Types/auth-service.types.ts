import type { AuthenticatedUser } from '../../../../shared/Types/auth.types'

export interface CurrentSession {
    readonly id: string
    readonly expiresAt: Date
    readonly user: AuthenticatedUser
}

export type AuthState =
    | {
          readonly setupRequired: true
          readonly session: null
          readonly user: null
      }
    | {
          readonly setupRequired: false
          readonly session: CurrentSession | null
          readonly user: AuthenticatedUser | null
      }

export type LoginResult =
    | {
          readonly success: true
          readonly user: AuthenticatedUser
          readonly session: {
              readonly id: string
              readonly token: string
              readonly expiresAt: Date
          }
      }
    | {
          readonly success: false
          readonly code: 'invalid_credentials'
      }

export interface TokenDelivery {
    readonly displayName: string
    readonly email: string
    readonly token: string
    readonly expiresAt: Date
}

export type TokenConsumptionResult =
    | { readonly success: true; readonly userId: string }
    | { readonly success: false; readonly code: 'invalid_or_expired_token' }

export type ChangePasswordResult =
    | { readonly success: true }
    | { readonly success: false; readonly code: 'invalid_current_password' }

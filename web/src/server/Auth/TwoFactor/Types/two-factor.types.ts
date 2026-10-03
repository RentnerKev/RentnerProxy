export interface TwoFactorStatus {
    readonly recoveryCodesRemaining: number
    readonly totpEnabled: boolean
}

export type MfaLoginCompletionResult =
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

export type TwoFactorLoginMode = 'totp' | 'recovery'

export interface TwoFactorLoginFormValues {
    readonly mode: TwoFactorLoginMode
    readonly credential: string
}

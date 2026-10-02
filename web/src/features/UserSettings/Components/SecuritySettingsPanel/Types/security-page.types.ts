import type { SecurityStatus, SecurityActionResult } from '../../../Types/security.types.ts'

export type DestructiveSecurityAction = 'disable' | 'regenerate' | 'remove'
export type ReauthenticationAction = 'add' | 'enable' | 'rename' | DestructiveSecurityAction

export type SecurityConfirmation =
    | { readonly kind: 'disable' }
    | { readonly kind: 'regenerate' }
    | { readonly kind: 'remove'; readonly passkeyId: string }

export type PasskeyNameRequest =
    | { readonly kind: 'add'; readonly initialName?: string }
    | { readonly kind: 'rename'; readonly initialName?: string; readonly passkeyId: string }

export interface SecurityPageLogicResult {
    state: {
        status: SecurityStatus | undefined
        setup: { challengeId: string; secret: string; otpAuthUrl: string } | null
        recoveryCodes: ReadonlyArray<string> | null
        isLoading: boolean
        error: Error | null
        isPending: boolean
        reauthenticationCredential: string
        isReauthenticationPending: boolean
        confirmationTitle: string
        confirmationDescription: string
        confirmationLabel: string
        confirmation: SecurityConfirmation | null
        nameRequest: PasskeyNameRequest | null
        reauthAction: ReauthenticationAction | null
    }
    setter: { setReauthenticationCredential: (value: string) => void }
    handler: {
        handleConfirmationOpenChange: (open: boolean) => void
        handleReauthenticationOpenChange: (open: boolean) => void
        resetSetup: () => void
        resetRecoveryCodes: () => void
        closeConfirmation: () => void
        closePasskeyName: () => void
        closeReauthentication: () => void
        confirmDestructiveAction: () => Promise<void>
        confirmTotp: (code: string) => Promise<SecurityActionResult | undefined>
        confirmPasskeyName: (name: string) => Promise<void>
        confirmReauthentication: () => Promise<void>
        reauthenticateWithPasskey: () => Promise<void>
        requestAddPasskey: () => void
        requestDestructiveAction: (action: DestructiveSecurityAction, passkeyId?: string) => void
        requestEnableTotp: () => void
        requestRename: (passkeyId: string) => void
    }
}

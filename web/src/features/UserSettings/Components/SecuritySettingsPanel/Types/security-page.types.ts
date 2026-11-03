import type { SecurityStatus, SecurityActionResult } from '../../../Types/security.types.ts'

export type DestructiveSecurityAction = 'disable' | 'regenerate' | 'remove'

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
        confirmationTitle: string
        confirmationDescription: string
        confirmationLabel: string
        confirmation: SecurityConfirmation | null
        nameRequest: PasskeyNameRequest | null
    }
    handler: {
        handleConfirmationOpenChange: (open: boolean) => void
        resetSetup: () => void
        resetRecoveryCodes: () => void
        closePasskeyName: () => void
        confirmDestructiveAction: () => Promise<void>
        confirmTotp: (code: string) => Promise<SecurityActionResult | undefined>
        confirmPasskeyName: (name: string) => Promise<void>
        requestAddPasskey: () => void
        requestDestructiveAction: (action: DestructiveSecurityAction, passkeyId?: string) => void
        requestEnableTotp: () => void
        requestRename: (passkeyId: string) => void
    }
}

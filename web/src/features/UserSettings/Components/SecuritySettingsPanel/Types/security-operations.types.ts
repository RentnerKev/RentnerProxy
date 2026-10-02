import type {
    beginTotpSetupHandler,
    confirmTotpSetupHandler,
    disableTotpHandler,
    regenerateRecoveryCodesHandler,
    beginPasskeyRegistrationHandler,
    finishPasskeyRegistrationHandler,
    renamePasskeyHandler,
    removePasskeyHandler,
} from '../../../middleware.ts'
import type {
    SecurityStatus,
    SerializedRegistrationResponse,
} from '../../../Types/security.types.ts'

export interface SecurityOperationsResult {
    state: {
        status: SecurityStatus | undefined
        setup: { challengeId: string; secret: string; otpAuthUrl: string } | null
        recoveryCodes: ReadonlyArray<string> | null
        isLoading: boolean
        error: Error | null
        isPending: boolean
    }
    handler: {
        resetSetup: () => void
        resetRecoveryCodes: () => void
        beginTotp: () => ReturnType<typeof beginTotpSetupHandler>
        confirmTotp: (code: string) => ReturnType<typeof confirmTotpSetupHandler>
        disableTotp: () => ReturnType<typeof disableTotpHandler>
        regenerate: () => ReturnType<typeof regenerateRecoveryCodesHandler>
        beginPasskey: () => ReturnType<typeof beginPasskeyRegistrationHandler>
        finishPasskey: (input: {
            challengeId: string
            name: string
            response: SerializedRegistrationResponse
        }) => ReturnType<typeof finishPasskeyRegistrationHandler>
        rename: (input: {
            passkeyId: string
            name: string
        }) => ReturnType<typeof renamePasskeyHandler>
        remove: (input: { passkeyId: string }) => ReturnType<typeof removePasskeyHandler>
    }
}

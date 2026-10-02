import type {
    beginPasskeyReauthenticationHandler,
    finishPasskeyReauthenticationHandler,
    reauthenticatePasswordHandler,
} from '../../../middleware.ts'
import type { SerializedAuthenticationResponse } from '../../../Types/security.types.ts'

export interface ReauthenticationResult {
    state: { credential: string; isPending: boolean }
    setter: { setCredential: (value: string) => void }
    handler: {
        reset: () => void
        verifyPassword: () => ReturnType<typeof reauthenticatePasswordHandler>
        beginPasskey: () => ReturnType<typeof beginPasskeyReauthenticationHandler>
        finishPasskey: (input: {
            challengeId: string
            response: SerializedAuthenticationResponse
        }) => ReturnType<typeof finishPasskeyReauthenticationHandler>
    }
}

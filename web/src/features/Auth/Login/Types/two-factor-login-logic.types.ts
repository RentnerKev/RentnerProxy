import type { FormEventHandler } from 'react'
import type { TwoFactorLoginMode } from './login-security.types.ts'
import type { normalizeTwoFactorCredential } from '../validation.ts'
export interface TwoFactorLoginLogicResult<TForm> {
    form: TForm
    state: {
        isLoading: boolean
        isStatusError: boolean
        isPending: boolean
        isValid: boolean
        methods: ReadonlyArray<TwoFactorLoginMode>
    }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        validateCredential: (context: { value: string }) => string | undefined
        normalizeCredential: typeof normalizeTwoFactorCredential
        toggleMode: () => void
        handleRetryStatus: () => void
    }
}

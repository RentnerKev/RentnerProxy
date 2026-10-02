import type { FormEventHandler } from 'react'
import type { TwoFactorLoginMode } from './login-security.types.ts'
import type { getTwoFactorCredentialError, normalizeTwoFactorCredential } from '../validation.ts'
export interface TwoFactorLoginLogicResult<TForm> {
    form: TForm
    state: {
        isLoading: boolean
        isPending: boolean
        isValid: boolean
        methods: ReadonlyArray<TwoFactorLoginMode>
    }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        validateCredential: (context: { value: string }) => string | undefined

        getCredentialError: typeof getTwoFactorCredentialError
        normalizeCredential: typeof normalizeTwoFactorCredential
        toggleMode: () => void
    }
}

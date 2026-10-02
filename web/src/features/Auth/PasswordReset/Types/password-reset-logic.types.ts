import type { FormEventHandler } from 'react'
export interface PasswordResetLogicResult<TForm> {
    form: TForm
    state: {
        isPending: boolean
        token: string | null | undefined
    }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        validatePassword: (context: { value: string }) => string | undefined
        validateConfirmPassword: (context: { value: string }) => string | undefined
    }
}

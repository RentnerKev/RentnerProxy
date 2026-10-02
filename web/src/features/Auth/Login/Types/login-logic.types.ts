import type { FormEventHandler } from 'react'
export interface LoginLogicResult<TForm> {
    form: TForm
    state: {
        isPending: boolean
        isPasskeyPending: boolean
    }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        validateEmail: (context: { value: string }) => string | undefined
        validatePassword: (context: { value: string }) => string | undefined
        handlePasskeyLogin: () => Promise<void>
    }
}

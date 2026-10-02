import type { FormEventHandler } from 'react'
export interface ForgotPasswordLogicResult<TForm> {
    form: TForm
    state: {
        isPending: boolean
    }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        validateEmail: (context: { value: string }) => string | undefined
    }
}

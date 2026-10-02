import type { FormEventHandler } from 'react'
export interface SetupLogicResult<TForm> {
    form: TForm
    state: {
        isPending: boolean
    }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        validateDisplayName: (context: { value: string }) => string | undefined
        validateEmail: (context: { value: string }) => string | undefined
        validatePassword: (context: { value: string }) => string | undefined
        validateConfirmPassword: (context: { value: string }) => string | undefined
    }
}

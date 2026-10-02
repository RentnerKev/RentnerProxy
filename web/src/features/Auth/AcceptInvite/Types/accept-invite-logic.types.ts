import type { FormEventHandler } from 'react'
export interface AcceptInviteLogicResult<TForm> {
    form: TForm
    state: {
        isPending: boolean
        token: string | null | undefined
    }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        validateDisplayName: (context: { value: string }) => string | undefined
        validatePassword: (context: { value: string }) => string | undefined
        validateConfirmPassword: (context: { value: string }) => string | undefined
    }
}

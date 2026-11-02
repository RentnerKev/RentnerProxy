import type { FormEventHandler, RefObject } from 'react'
import type { MenuItem } from '@rentnerkev/menu'
export interface LoginLogicResult<TForm> {
    form: TForm
    state: {
        validationEpochs: Readonly<Record<string, number>>
        isPending: boolean
        isPasskeyPending: boolean
        alternativeSignInItems: readonly MenuItem[]
    }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        validateEmail: (context: { value: string }) => string | undefined
        validatePassword: (context: { value: string }) => string | undefined
        handlePasskeyLogin: () => Promise<void>
        handleOidcSubmit: FormEventHandler<HTMLFormElement>
        handleAlternativeSignIn: (id: string) => void
    }
    refs: {
        oidcForm: RefObject<HTMLFormElement | null>
        oidcProviderId: RefObject<HTMLInputElement | null>
    }
}

import type { FormEventHandler, RefObject } from 'react'
export interface AlternativeSignInOption {
    readonly id: string
    readonly label: string
}
export interface LoginLogicResult<TForm> {
    form: TForm
    state: {
        isPending: boolean
        isPasskeyPending: boolean
        isOidcPending: boolean
        isProviderCatalogPending: boolean
        isProviderCatalogUnavailable: boolean
        oidcFeedback: string | null
        alternativeSignInItems: readonly AlternativeSignInOption[]
    }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        validateEmail: (context: { value: string }) => string | undefined
        validatePassword: (context: { value: string }) => string | undefined
        handlePasskeyLogin: () => Promise<void>
        handleOidcSubmit: FormEventHandler<HTMLFormElement>
        handleAlternativeSignIn: (id: string) => void
        handleCancelOidc: () => void
    }
    refs: {
        oidcForm: RefObject<HTMLFormElement | null>
        oidcProviderId: RefObject<HTMLInputElement | null>
    }
}

import type useLoginLogic from '../Hooks/useLoginLogic'
import type useTwoFactorLoginLogic from '../Hooks/useTwoFactorLoginLogic'

export interface LoginFormProps {
    readonly state: ReturnType<typeof useLoginLogic>['state']
    readonly onPasskeyLogin: () => void
}

export interface TwoFactorLoginFormProps {
    readonly state: ReturnType<typeof useTwoFactorLoginLogic>['state']
    readonly onToggleMode: () => void
    readonly getCredentialError: ReturnType<
        typeof useTwoFactorLoginLogic
    >['handler']['getCredentialError']
    readonly normalizeCredential: ReturnType<
        typeof useTwoFactorLoginLogic
    >['handler']['normalizeCredential']
}

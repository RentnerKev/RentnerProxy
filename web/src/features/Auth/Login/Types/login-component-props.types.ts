import type { TwoFactorLoginLogicResult } from './two-factor-login-logic.types.ts'
import type { LoginLogicResult } from './login-logic.types.ts'
import type useLoginLogic from '../Hooks/useLoginLogic.ts'
import type useTwoFactorLoginLogic from '../Hooks/useTwoFactorLoginLogic.ts'

export interface LoginFormProps {
    readonly handler: LoginLogicResult<unknown>['handler']
    readonly state: LoginLogicResult<unknown>['state']
    readonly form: ReturnType<typeof useLoginLogic>['form']
    readonly onPasskeyLogin: () => void
}

export interface TwoFactorLoginFormProps {
    readonly handler: TwoFactorLoginLogicResult<unknown>['handler']
    readonly state: TwoFactorLoginLogicResult<unknown>['state']
    readonly form: ReturnType<typeof useTwoFactorLoginLogic>['form']
    readonly onToggleMode: () => void
    readonly normalizeCredential: TwoFactorLoginLogicResult<unknown>['handler']['normalizeCredential']
}

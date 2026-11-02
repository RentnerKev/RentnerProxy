import type { TwoFactorLoginLogicResult } from './two-factor-login-logic.types.ts'
import type { LoginLogicResult } from './login-logic.types.ts'
import type useLoginLogic from '../Hooks/useLoginLogic.ts'
import type useTwoFactorLoginLogic from '../Hooks/useTwoFactorLoginLogic.ts'

export interface LoginFormProps {
    readonly handler: LoginLogicResult<unknown>['handler']
    readonly state: LoginLogicResult<unknown>['state']
    readonly form: ReturnType<typeof useLoginLogic>['form']
}

export interface AlternativeLoginMethodsProps {
    readonly state: LoginLogicResult<unknown>['state']
    readonly handler: LoginLogicResult<unknown>['handler']
    readonly refs: LoginLogicResult<unknown>['refs']
}

export interface TwoFactorLoginFormProps {
    readonly handler: TwoFactorLoginLogicResult<unknown>['handler']
    readonly state: TwoFactorLoginLogicResult<unknown>['state']
    readonly form: ReturnType<typeof useTwoFactorLoginLogic>['form']
    readonly onToggleMode: () => void
    readonly normalizeCredential: TwoFactorLoginLogicResult<unknown>['handler']['normalizeCredential']
}

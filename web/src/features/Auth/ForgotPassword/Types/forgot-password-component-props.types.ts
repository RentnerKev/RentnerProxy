import type { ForgotPasswordLogicResult } from './forgot-password-logic.types.ts'
import type useForgotPasswordLogic from '../Hooks/useForgotPasswordLogic.ts'

export interface ForgotPasswordFormProps {
    readonly handler: ForgotPasswordLogicResult<unknown>['handler']
    readonly state: ForgotPasswordLogicResult<unknown>['state']
    readonly form: ReturnType<typeof useForgotPasswordLogic>['form']
}

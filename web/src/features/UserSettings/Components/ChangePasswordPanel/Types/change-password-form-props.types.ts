import type { ChangePasswordLogicResult } from './change-password-logic.types.ts'
import type useChangePasswordLogic from '../Hooks/useChangePasswordLogic.ts'

export interface ChangePasswordFormProps {
    readonly handler: ChangePasswordLogicResult<unknown>['handler']
    readonly state: ChangePasswordLogicResult<unknown>['state']
    readonly form: ReturnType<typeof useChangePasswordLogic>['form']
}

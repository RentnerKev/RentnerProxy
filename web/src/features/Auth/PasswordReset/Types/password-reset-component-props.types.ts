import type { PasswordResetLogicResult } from './password-reset-logic.types.ts'
import type usePasswordResetLogic from '../Hooks/usePasswordResetLogic.ts'

export interface PasswordResetFormProps {
    readonly handler: PasswordResetLogicResult<unknown>['handler']
    readonly state: PasswordResetLogicResult<unknown>['state']
    readonly form: ReturnType<typeof usePasswordResetLogic>['form']
}

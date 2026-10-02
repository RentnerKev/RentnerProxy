import type { SetupLogicResult } from './setup-logic.types.ts'
import type useSetupLogic from '../Hooks/useSetupLogic.ts'

export interface SetupFormProps {
    readonly handler: SetupLogicResult<unknown>['handler']
    readonly state: SetupLogicResult<unknown>['state']
    readonly form: ReturnType<typeof useSetupLogic>['form']
}

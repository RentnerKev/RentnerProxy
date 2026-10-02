import type { AcceptInviteLogicResult } from './accept-invite-logic.types.ts'
import type useAcceptInviteLogic from '../Hooks/useAcceptInviteLogic.ts'

export interface AcceptInviteFormProps {
    readonly handler: AcceptInviteLogicResult<unknown>['handler']
    readonly state: AcceptInviteLogicResult<unknown>['state']
    readonly form: ReturnType<typeof useAcceptInviteLogic>['form']
}

import type useAcceptInviteLogic from '../Hooks/useAcceptInviteLogic'

export interface AcceptInviteFormProps {
    readonly state: ReturnType<typeof useAcceptInviteLogic>['state']
}

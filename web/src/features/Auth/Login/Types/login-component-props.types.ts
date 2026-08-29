import type useLoginLogic from '../Hooks/useLoginLogic'

export interface LoginFormProps {
    readonly state: ReturnType<typeof useLoginLogic>['state']
}

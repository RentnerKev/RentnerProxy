import type useSetupLogic from '../Hooks/useSetupLogic'

export interface SetupFormProps {
    readonly state: ReturnType<typeof useSetupLogic>['state']
}

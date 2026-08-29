import type usePasswordResetLogic from '../Hooks/usePasswordResetLogic'

export interface PasswordResetFormProps {
    readonly state: ReturnType<typeof usePasswordResetLogic>['state']
}

import type useForgotPasswordLogic from '../Hooks/useForgotPasswordLogic'

export interface ForgotPasswordFormProps {
    readonly state: ReturnType<typeof useForgotPasswordLogic>['state']
}

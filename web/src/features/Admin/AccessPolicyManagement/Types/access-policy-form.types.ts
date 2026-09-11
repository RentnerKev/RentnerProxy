import type {
    AccessPolicyCombination,
    AccessPolicyMode,
} from '../../../../config/access-policies.config'
import type { AccessPolicySummary } from '../../../../shared/Types/access-policies.types'

export interface AccessPolicyFormModalProps {
    readonly mode: 'create' | 'edit'
    readonly onOpenChange: (open: boolean) => void
    readonly onSuccess: () => void
    readonly open: boolean
    readonly policy?: AccessPolicySummary | undefined
}

export interface AccessPolicyFormValues {
    readonly name: string
    readonly mode: AccessPolicyMode
    readonly combination: AccessPolicyCombination | null
}

export interface AccessPolicyFormModalState {
    readonly description: string
    readonly errors: Readonly<{
        name?: string | undefined
        combination?: string | undefined
    }>
    readonly formId: string
    readonly isPending: boolean
    readonly pendingSubmitLabel: string
    readonly submitLabel: string
    readonly title: string
    readonly values: AccessPolicyFormValues
}

export interface AccessPolicyFormModalHandler {
    readonly handleSubmit: (event: React.FormEvent<HTMLFormElement>) => void
    readonly setCombination: (value: string) => void
    readonly setMode: (value: string) => void
    readonly setName: (value: string) => void
}

export interface AccessPolicyFormFieldsProps {
    readonly errors: AccessPolicyFormModalState['errors']
    readonly formId: string
    readonly isPending: boolean
    readonly setCombination: AccessPolicyFormModalHandler['setCombination']
    readonly setMode: AccessPolicyFormModalHandler['setMode']
    readonly setName: AccessPolicyFormModalHandler['setName']
    readonly values: AccessPolicyFormValues
}

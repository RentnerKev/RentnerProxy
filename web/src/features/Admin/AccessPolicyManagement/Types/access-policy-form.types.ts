import type {
    AccessPolicyCombination,
    AccessPolicyMode,
} from '../../../../config/access-policies.config'
import type { AccessPolicySummary } from '../../../../shared/Types/access-policies.types'
import type { AccessPolicyIpRulesDraft } from '../Helpers/ipAccessPolicyState'

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
    readonly ipRules: AccessPolicyIpRulesDraft | null
}

export interface AccessPolicyFormSubmitValues {
    readonly name: string
    readonly mode: AccessPolicyMode
    readonly combination: AccessPolicyCombination | null
    readonly ipRules: AccessPolicySummary['ipRules']
}

export interface AccessPolicyFormModalState {
    readonly description: string
    readonly errors: Readonly<{
        name?: string | undefined
        combination?: string | undefined
        ipRules?: string | undefined
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
    readonly setIpRules: (value: AccessPolicyIpRulesDraft | null) => void
    readonly setIpRuleDefaultAction: (value: string) => void
    readonly setIpRuleAllow: (value: string) => void
    readonly setIpRuleDeny: (value: string) => void
    readonly setMode: (value: string) => void
    readonly setName: (value: string) => void
}

export interface AccessPolicyFormFieldsProps {
    readonly basicAuthAccountCount: number
    readonly errors: AccessPolicyFormModalState['errors']
    readonly formId: string
    readonly isPending: boolean
    readonly setCombination: AccessPolicyFormModalHandler['setCombination']
    readonly setIpRules: AccessPolicyFormModalHandler['setIpRules']
    readonly setIpRuleDefaultAction: AccessPolicyFormModalHandler['setIpRuleDefaultAction']
    readonly setIpRuleAllow: AccessPolicyFormModalHandler['setIpRuleAllow']
    readonly setIpRuleDeny: AccessPolicyFormModalHandler['setIpRuleDeny']
    readonly setMode: AccessPolicyFormModalHandler['setMode']
    readonly setName: AccessPolicyFormModalHandler['setName']
    readonly values: AccessPolicyFormValues
}

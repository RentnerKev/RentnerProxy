import type { AccessPolicyFormFieldsProps } from './access-policy-form.types.ts'
import type { AccessPolicyAvailabilityStatus } from '@/lib/Admin/AccessPolicyManagement/basicAuthPolicyState.ts'

export type AccessPolicyFormFieldsLogicInputs = Pick<
    AccessPolicyFormFieldsProps,
    'values' | 'basicAuthAccountCount'
>
export interface AccessPolicyFormFieldsLogicResult {
    readonly state: {
        readonly ipRulesSectionVisible: boolean
        readonly authenticationModeVisible: boolean
        readonly availability: AccessPolicyAvailabilityStatus
        readonly availabilityKey:
            | AccessPolicyAvailabilityStatus
            | 'forwardAuthConfigured'
            | 'forwardAuthMissing'
        readonly availabilityClassName: string
    }
}

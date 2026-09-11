import type { AccessPolicyCombination, AccessPolicyMode } from '../../config/access-policies.config'

export interface AccessPolicySummary {
    readonly id: string
    readonly name: string
    readonly description: string
    readonly mode: AccessPolicyMode
    readonly combination: AccessPolicyCombination | null
    readonly assignedHostCount: number
    readonly createdAt: Date
    readonly updatedAt: Date
}

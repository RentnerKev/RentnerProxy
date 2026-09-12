import type { ReactNode } from 'react'

import type { AccessPolicySummary } from '../../../../shared/Types/access-policies.types'

export interface AccessPoliciesTableProps {
    readonly action?: ReactNode
    readonly canDelete: boolean
    readonly canViewCredentials?: boolean
    readonly canUpdate: boolean
    readonly isLoading: boolean
    readonly isPending: boolean
    readonly onCredentials?: (policy: AccessPolicySummary) => void
    readonly onDelete: (policy: AccessPolicySummary) => void
    readonly onEdit: (policy: AccessPolicySummary) => void
    readonly policies: ReadonlyArray<AccessPolicySummary>
}

export type AccessPolicyTableActionProps = Pick<
    AccessPoliciesTableProps,
    | 'canDelete'
    | 'canUpdate'
    | 'canViewCredentials'
    | 'isPending'
    | 'onCredentials'
    | 'onDelete'
    | 'onEdit'
>

export interface AccessPolicyTableActionsProps extends AccessPolicyTableActionProps {
    readonly policy: AccessPolicySummary
}

export interface AccessPolicyNameCellProps {
    readonly name: string
}

export interface AccessPolicyModeCellProps {
    readonly mode: AccessPolicySummary['mode']
}

export interface AccessPolicyCombinationCellProps {
    readonly combination: AccessPolicySummary['combination']
}

export interface AccessPolicyAssignedCountCellProps {
    readonly value: number
}

export interface AccessPolicyCreatedAtCellProps {
    readonly value: unknown
}

export interface AccessPolicyBasicAuthCellProps {
    readonly combination: AccessPolicySummary['combination']
    readonly count: number
    readonly mode: AccessPolicySummary['mode']
    readonly ipRules: AccessPolicySummary['ipRules']
}

export interface AccessPolicyIpRulesCellProps {
    readonly basicAuthAccountCount: number
    readonly combination: AccessPolicySummary['combination']
    readonly ipRules: AccessPolicySummary['ipRules']
    readonly mode: AccessPolicySummary['mode']
}

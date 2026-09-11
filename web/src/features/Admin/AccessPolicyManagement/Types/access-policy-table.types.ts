import type { ReactNode } from 'react'

import type { AccessPolicySummary } from '../../../../shared/Types/access-policies.types'

export interface AccessPoliciesTableProps {
    readonly action?: ReactNode
    readonly canDelete: boolean
    readonly canUpdate: boolean
    readonly isLoading: boolean
    readonly isPending: boolean
    readonly onDelete: (policy: AccessPolicySummary) => void
    readonly onEdit: (policy: AccessPolicySummary) => void
    readonly policies: ReadonlyArray<AccessPolicySummary>
}

export type AccessPolicyTableActionProps = Pick<
    AccessPoliciesTableProps,
    'canDelete' | 'canUpdate' | 'isPending' | 'onDelete' | 'onEdit'
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

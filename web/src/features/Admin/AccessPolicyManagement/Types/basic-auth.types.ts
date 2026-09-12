import type { ReactNode } from 'react'

import type { AccessPolicySummary } from '../../../../shared/Types/access-policies.types'

export interface BasicAuthAccount {
    readonly id: string
    readonly accessPolicyId: string
    readonly username: string
    readonly createdAt: Date
    readonly updatedAt: Date
}

export interface BasicAuthActionResult {
    readonly success: boolean
    readonly message: string
    readonly runtimeStatus?: 'applied' | 'pending'
}

export interface BasicAuthAccountsModalProps {
    readonly canUpdate: boolean
    readonly onAccountsChange: () => void | Promise<void>
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
    readonly policy: AccessPolicySummary
}

export interface BasicAuthAccountListProps {
    readonly accounts: readonly BasicAuthAccount[]
    readonly canUpdate: boolean
    readonly isPending: boolean
    readonly onDelete: (account: BasicAuthAccount) => void
    readonly onEdit: (account: BasicAuthAccount) => void
}

export interface BasicAuthAccountFormModalProps {
    readonly accessPolicyId: string
    readonly account?: BasicAuthAccount | undefined
    readonly mode: 'create' | 'edit'
    readonly onOpenChange: (open: boolean) => void
    readonly onSuccess: () => void | Promise<void>
    readonly open: boolean
}

export interface BasicAuthAccountFormValues {
    readonly username: string
    readonly password: string
}

export interface BasicAuthAccountFormErrors {
    readonly username?: string | undefined
    readonly password?: string | undefined
}

export interface BasicAuthAccountFormFieldsProps {
    readonly errors: BasicAuthAccountFormErrors
    readonly formId: string
    readonly isPending: boolean
    readonly mode: 'create' | 'edit'
    readonly setPassword: (value: string) => void
    readonly setUsername: (value: string) => void
    readonly values: BasicAuthAccountFormValues
}

export interface BasicAuthAvailabilityCellProps {
    readonly combination: AccessPolicySummary['combination']
    readonly count: number
    readonly mode: AccessPolicySummary['mode']
}

export type BasicAuthStatus =
    | 'available'
    | 'combinedAnyAvailable'
    | 'combinedAnyMissing'
    | 'ipProviderRequired'
    | 'publicIgnored'

export interface BasicAuthAccountListEmptyProps {
    readonly action?: ReactNode
}

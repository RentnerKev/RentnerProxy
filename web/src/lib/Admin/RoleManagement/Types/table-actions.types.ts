import type { RoleManagementSummary } from '@/lib/Auth/Types/auth.types.ts'
import type { ActionMenuItem } from '@/shared/ActionMenu/Types/action-menu.types.ts'

export interface RoleTableActionInputs {
    readonly canDelete: boolean
    readonly canUpdate: boolean
    readonly role: RoleManagementSummary
    readonly onDelete: (value: RoleManagementSummary) => void
    readonly onEdit: (value: RoleManagementSummary) => void
}

export type RoleTableActionState =
    | { readonly kind: 'protected' }
    | { readonly kind: 'actions'; readonly items: Array<ActionMenuItem> }

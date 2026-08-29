import type { ActionMenuItem } from '../../../../shared/ActionMenu'
import type { RoleTableActionsProps } from '../Types/role-management-component-props.types'

export type RoleTableActionState =
    | { readonly kind: 'protected' }
    | { readonly kind: 'actions'; readonly items: Array<ActionMenuItem> }

export function getRoleTableActionState({
    canDelete,
    canUpdate,
    onDelete,
    onEdit,
    role,
}: RoleTableActionsProps): RoleTableActionState {
    if (role.isSystem) {
        return { kind: 'protected' }
    }

    const items: Array<ActionMenuItem> = []

    if (canUpdate) {
        items.push({ label: 'Edit', onSelect: () => onEdit(role) })
    }

    if (canDelete) {
        items.push({
            label: 'Delete',
            onSelect: () => onDelete(role),
            destructive: true,
            disabled: role.userCount > 0,
            description:
                role.userCount > 0
                    ? `Assigned to ${role.userCount} ${role.userCount === 1 ? 'user' : 'users'}.`
                    : 'Permanently remove this custom role.',
        })
    }

    return { kind: 'actions', items }
}

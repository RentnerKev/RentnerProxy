import type { ActionMenuItem } from '../../../../shared/ActionMenu'
import type { Translate } from '../../../../language/useTranslationStore'
import type { RoleTableActionsProps } from '../Types/role-management-component-props.types'

export type RoleTableActionState =
    | { readonly kind: 'protected' }
    | { readonly kind: 'actions'; readonly items: Array<ActionMenuItem> }

export function getRoleTableActionState(
    { canDelete, canUpdate, onDelete, onEdit, role }: RoleTableActionsProps,
    t: Translate,
): RoleTableActionState {
    if (role.isSystem) {
        return { kind: 'protected' }
    }

    const items: Array<ActionMenuItem> = []

    if (canUpdate) {
        items.push({ label: t('admin.roles.actions.edit'), onSelect: () => onEdit(role) })
    }

    if (canDelete) {
        items.push({
            label: t('admin.roles.actions.delete'),
            onSelect: () => onDelete(role),
            destructive: true,
            disabled: role.userCount > 0,
            description:
                role.userCount > 0
                    ? t('admin.roles.actions.assignedTo', { count: role.userCount })
                    : t('admin.roles.actions.removeDescription'),
        })
    }

    return { kind: 'actions', items }
}

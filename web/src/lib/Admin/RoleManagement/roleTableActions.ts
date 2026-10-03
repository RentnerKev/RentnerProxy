import type { ActionMenuItem } from '@/shared/ActionMenu/Types/action-menu.types.ts'
import type { Translate } from '@/shared/Language/Types/language.types.ts'
import type { RoleTableActionInputs, RoleTableActionState } from './Types/table-actions.types.ts'

export function getRoleTableActionState(
    { canDelete, canUpdate, onDelete, onEdit, role }: RoleTableActionInputs,
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

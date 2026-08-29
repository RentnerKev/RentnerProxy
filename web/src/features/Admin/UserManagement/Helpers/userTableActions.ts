import { SYSTEM_ROLES } from '../../../../config/permissions.config'
import type { ActionMenuItem } from '../../../../shared/ActionMenu'
import type { UserTableActionsProps } from '../Types/user-management-component-props.types'

export function getUserTableActionItems({
    actorIsOwner,
    canDisable,
    canUpdate,
    currentUserId,
    onDisable,
    onEdit,
    user,
}: UserTableActionsProps): Array<ActionMenuItem> {
    const ownerProtected = user.roleKeys.includes(SYSTEM_ROLES.OWNER) && !actorIsOwner
    const selfProtected = user.id === currentUserId
    const items: Array<ActionMenuItem> = []

    if (canUpdate) {
        items.push({
            label: 'Edit',
            onSelect: () => onEdit(user),
            disabled: ownerProtected,
            ...(ownerProtected ? { description: 'Only an owner can edit this account.' } : {}),
        })
    }

    if (canDisable && user.status !== 'disabled') {
        const disableProtected = ownerProtected || selfProtected

        items.push({
            label: 'Disable',
            onSelect: () => onDisable(user),
            destructive: true,
            disabled: disableProtected,
            description: ownerProtected
                ? 'Only an owner can disable this account.'
                : selfProtected
                  ? 'You cannot disable your own account.'
                  : 'Revoke sessions and block sign-in.',
        })
    }

    return items
}

import { SYSTEM_ROLES } from '../../../../config/permissions.config'
import type { ActionMenuItem } from '../../../../shared/ActionMenu'
import type { Translate } from '../../../../language/useTranslationStore'
import type { UserTableActionsProps } from '../Types/user-management-component-props.types'

export function getUserTableActionItems(
    {
        actorIsOwner,
        canDisable,
        canUpdate,
        currentUserId,
        onDisable,
        onEdit,
        user,
    }: UserTableActionsProps,
    t: Translate,
): Array<ActionMenuItem> {
    const ownerProtected = user.roleKeys.includes(SYSTEM_ROLES.OWNER) && !actorIsOwner
    const selfProtected = user.id === currentUserId
    const items: Array<ActionMenuItem> = []

    if (canUpdate) {
        items.push({
            label: t('admin.users.actions.edit'),
            onSelect: () => onEdit(user),
            disabled: ownerProtected,
            ...(ownerProtected ? { description: t('admin.users.actions.ownerEdit') } : {}),
        })
    }

    if (canDisable && user.status !== 'disabled') {
        const disableProtected = ownerProtected || selfProtected

        items.push({
            label: t('admin.users.actions.disable'),
            onSelect: () => onDisable(user),
            destructive: true,
            disabled: disableProtected,
            description: ownerProtected
                ? t('admin.users.actions.ownerDisable')
                : selfProtected
                  ? t('admin.users.actions.selfDisable')
                  : t('admin.users.actions.disableDescription'),
        })
    }

    return items
}

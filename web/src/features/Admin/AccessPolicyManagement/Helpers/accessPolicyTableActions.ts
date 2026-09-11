import type { ActionMenuItem } from '../../../../shared/ActionMenu'
import type { Translate } from '../../../../language/useTranslationStore'
import type { AccessPolicyTableActionsProps } from '../Types/access-policy-table.types'

export function getAccessPolicyTableActionItems(
    { canDelete, canUpdate, isPending, onDelete, onEdit, policy }: AccessPolicyTableActionsProps,
    t: Translate,
): Array<ActionMenuItem> {
    const items: Array<ActionMenuItem> = []

    if (canUpdate) {
        items.push({
            label: t('admin.accessPolicies.actions.edit'),
            onSelect: () => onEdit(policy),
            disabled: isPending,
        })
    }

    if (canDelete) {
        const assigned = policy.assignedHostCount > 0
        items.push({
            label: t('admin.accessPolicies.actions.delete'),
            onSelect: () => onDelete(policy),
            destructive: true,
            disabled: isPending || assigned,
            description: assigned
                ? t('admin.accessPolicies.actions.deleteAssigned')
                : t('admin.accessPolicies.actions.deleteDescription', { name: policy.name }),
        })
    }

    return items
}

import type { ActionMenuItem } from '../../../../shared/ActionMenu'
import type { Translate } from '../../../../language/useTranslationStore'
import type { RedirectHostTableActionsProps } from '../Types/redirect-host-table.types'
export function getRedirectHostTableActionItems(
    {
        canDelete,
        canDisable,
        canEnable,
        canUpdate,
        isPending,
        onDelete,
        onDisable,
        onEdit,
        onEnable,
        host,
    }: RedirectHostTableActionsProps,
    t: Translate,
): Array<ActionMenuItem> {
    const name = host.domains[0] ?? host.destination
    const items: Array<ActionMenuItem> = []
    if (canUpdate)
        items.push({
            label: t('admin.redirectHosts.actions.edit'),
            onSelect: () => onEdit(host),
            disabled: isPending,
        })
    if (host.enabled && canDisable)
        items.push({
            label: t('admin.redirectHosts.actions.disable'),
            onSelect: () => onDisable(host),
            destructive: true,
            disabled: isPending,
            description: t('admin.redirectHosts.actions.disableDescription'),
        })
    if (!host.enabled && canEnable)
        items.push({
            label: t('admin.redirectHosts.actions.enable'),
            onSelect: () => onEnable(host),
            disabled: isPending,
            description: t('admin.redirectHosts.actions.enableDescription'),
        })
    if (canDelete)
        items.push({
            label: t('admin.redirectHosts.actions.delete'),
            onSelect: () => onDelete(host),
            destructive: true,
            disabled: isPending,
            description: t('admin.redirectHosts.actions.deleteDescription', { name }),
        })
    return items
}

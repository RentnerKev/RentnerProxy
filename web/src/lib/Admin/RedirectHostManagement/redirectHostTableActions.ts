import type { ActionMenuItem } from '@/shared/ActionMenu/Types/action-menu.types.ts'
import type { Translate } from '@/shared/Language/Types/language.types.ts'
import type { RedirectHostTableActionsProps } from '@/features/Admin/RedirectHostManagement/Types/redirect-host-table.types.ts'
export function getRedirectHostTableActionItems(
    {
        canDuplicate,
        onDuplicate,
        canDelete,
        canDisable,
        canEnable,
        canUpdate,
        isPending,
        onDelete,
        onDisable,
        onDomainCheck,
        onEdit,
        onEnable,
        host,
    }: RedirectHostTableActionsProps,
    t: Translate,
): Array<ActionMenuItem> {
    const name = host.domains[0] ?? host.destination
    const items: Array<ActionMenuItem> = []
    if (onDomainCheck) {
        items.push({
            label: t('admin.domainCheck.action'),
            id: 'domain-check',
            onSelect: () => onDomainCheck(host),
            disabled: isPending,
        })
    }

    if (canUpdate)
        items.push({
            label: t('admin.redirectHosts.actions.edit'),
            id: 'edit',
            onSelect: () => onEdit(host),
            disabled: isPending,
        })
    if (canDuplicate?.(host) && onDuplicate)
        items.push({
            label: t('admin.redirectHosts.actions.duplicate'),
            id: 'duplicate',
            onSelect: () => onDuplicate(host),
            disabled: isPending,
        })
    if (host.enabled && canDisable)
        items.push({
            label: t('admin.redirectHosts.actions.disable'),
            id: 'disable',
            onSelect: () => onDisable(host),
            destructive: true,
            disabled: isPending,
            description: t('admin.redirectHosts.actions.disableDescription'),
        })
    if (!host.enabled && canEnable)
        items.push({
            label: t('admin.redirectHosts.actions.enable'),
            id: 'enable',
            onSelect: () => onEnable(host),
            disabled: isPending,
            description: t('admin.redirectHosts.actions.enableDescription'),
        })
    if (canDelete)
        items.push({
            label: t('admin.redirectHosts.actions.delete'),
            id: 'delete',
            onSelect: () => onDelete(host),
            destructive: true,
            disabled: isPending,
            description: t('admin.redirectHosts.actions.deleteDescription', { name }),
        })
    return items
}

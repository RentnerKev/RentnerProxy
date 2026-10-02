import { ActionMenu } from '@/shared/ActionMenu/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { getProxyHostTableActionItems } from '@/lib/Admin/ProxyHostManagement/proxyHostTableActions.ts'
import type { ProxyHostTableActionsProps } from '../../../Types/proxy-host-table.types.ts'

export default function ProxyHostTableActions(props: ProxyHostTableActionsProps) {
    const { t } = useTranslationStore()
    const items = getProxyHostTableActionItems(props, t)
    const name = props.host.domains[0] ?? props.host.forwardHost

    return items.length > 0 ? (
        <ActionMenu
            items={items}
            ariaLabel={t('admin.proxyHosts.actions.open', { name })}
            openOnHover
        />
    ) : (
        <span className="text-xs text-muted" aria-label={t('admin.proxyHosts.actions.none')}>
            —
        </span>
    )
}

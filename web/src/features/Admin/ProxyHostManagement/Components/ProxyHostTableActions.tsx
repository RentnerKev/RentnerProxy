import { ActionMenu } from '../../../../shared/ActionMenu'
import useTranslationStore from '../../../../language/useTranslationStore'
import { getProxyHostTableActionItems } from '../Helpers/proxyHostTableActions'
import type { ProxyHostTableActionsProps } from '../Types/proxy-host-table.types'

export default function ProxyHostTableActions(props: ProxyHostTableActionsProps) {
    const { t } = useTranslationStore()
    const items = getProxyHostTableActionItems(props, t)
    const name = props.host.domains[0] ?? props.host.forwardHost

    return items.length > 0 ? (
        <ActionMenu items={items} ariaLabel={t('admin.proxyHosts.actions.open', { name })} />
    ) : (
        <span className="text-xs text-muted" aria-label={t('admin.proxyHosts.actions.none')}>
            —
        </span>
    )
}

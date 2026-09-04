import { ActionMenu } from '../../../../shared/ActionMenu'
import useTranslationStore from '../../../../language/useTranslationStore'
import { getRedirectHostTableActionItems } from '../Helpers/redirectHostTableActions'
import type { RedirectHostTableActionsProps } from '../Types/redirect-host-table.types'
export default function RedirectHostTableActions(props: RedirectHostTableActionsProps) {
    const { t } = useTranslationStore()
    const items = getRedirectHostTableActionItems(props, t)
    return items.length ? (
        <ActionMenu
            items={items}
            ariaLabel={t('admin.redirectHosts.actions.open', {
                name: props.host.domains[0] ?? props.host.destination,
            })}
            openOnHover
        />
    ) : (
        <span className="text-xs text-muted">—</span>
    )
}

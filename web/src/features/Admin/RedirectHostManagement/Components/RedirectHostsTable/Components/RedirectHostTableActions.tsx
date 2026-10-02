import { ActionMenu } from '@/shared/ActionMenu/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { getRedirectHostTableActionItems } from '@/lib/Admin/RedirectHostManagement/redirectHostTableActions.ts'
import type { RedirectHostTableActionsProps } from '../../../Types/redirect-host-table.types.ts'
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

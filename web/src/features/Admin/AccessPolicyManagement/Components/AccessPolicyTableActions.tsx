import { ActionMenu } from '../../../../shared/ActionMenu'
import useTranslationStore from '../../../../language/useTranslationStore'
import { getAccessPolicyTableActionItems } from '../Helpers/accessPolicyTableActions'
import type { AccessPolicyTableActionsProps } from '../Types/access-policy-table.types'

export default function AccessPolicyTableActions(props: AccessPolicyTableActionsProps) {
    const { t } = useTranslationStore()
    const items = getAccessPolicyTableActionItems(props, t)

    return items.length > 0 ? (
        <ActionMenu
            items={items}
            ariaLabel={t('admin.accessPolicies.actions.open', { name: props.policy.name })}
        />
    ) : (
        <span className="text-xs text-muted" aria-label={t('admin.accessPolicies.actions.none')}>
            —
        </span>
    )
}

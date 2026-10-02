import { ActionMenu } from '@/shared/ActionMenu/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { getAccessPolicyTableActionItems } from '@/lib/Admin/AccessPolicyManagement/accessPolicyTableActions.ts'
import type { AccessPolicyTableActionsProps } from '../../../Types/access-policy-table.types.ts'

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

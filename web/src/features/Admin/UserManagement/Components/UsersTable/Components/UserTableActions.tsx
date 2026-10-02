import { ActionMenu } from '@/shared/ActionMenu/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { getUserTableActionItems } from '@/lib/Admin/UserManagement/userTableActions.ts'
import type { UserTableActionsProps } from '../../../Types/user-management-component-props.types.ts'

export default function UserTableActions(props: UserTableActionsProps) {
    const { t } = useTranslationStore()
    const items = getUserTableActionItems(props, t)

    return items.length > 0 ? (
        <ActionMenu
            items={items}
            ariaLabel={t('admin.users.actions.open', { name: props.user.displayName })}
        />
    ) : (
        <span className="text-xs text-muted" aria-label={t('admin.users.actions.none')}>
            —
        </span>
    )
}

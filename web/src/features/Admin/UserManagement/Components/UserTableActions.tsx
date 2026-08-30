import { ActionMenu } from '../../../../shared/ActionMenu'
import useTranslationStore from '../../../../language/useTranslationStore'
import { getUserTableActionItems } from '../Helpers/userTableActions'
import type { UserTableActionsProps } from '../Types/user-management-component-props.types'

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

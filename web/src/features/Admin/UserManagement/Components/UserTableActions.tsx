import { ActionMenu } from '../../../../shared/ActionMenu'
import { getUserTableActionItems } from '../Helpers/userTableActions'
import type { UserTableActionsProps } from '../Types/user-management-component-props.types'

export default function UserTableActions(props: UserTableActionsProps) {
    const items = getUserTableActionItems(props)

    return items.length > 0 ? (
        <ActionMenu items={items} ariaLabel={`Open actions for ${props.user.displayName}`} />
    ) : (
        <span className="text-xs text-muted" aria-label="No actions available">
            —
        </span>
    )
}

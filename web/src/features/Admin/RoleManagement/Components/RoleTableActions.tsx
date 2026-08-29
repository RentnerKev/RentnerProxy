import { ActionMenu } from '../../../../shared/ActionMenu'
import { getRoleTableActionState } from '../Helpers/roleTableActions'
import type { RoleTableActionsProps } from '../Types/role-management-component-props.types'

export default function RoleTableActions(props: RoleTableActionsProps) {
    const actionState = getRoleTableActionState(props)

    if (actionState.kind === 'protected') {
        return (
            <span className="inline-flex rounded-full bg-neutral px-2.5 py-1 text-[0.66rem] font-extrabold text-muted">
                Protected
            </span>
        )
    }

    return actionState.items.length > 0 ? (
        <ActionMenu items={actionState.items} ariaLabel={`Open actions for ${props.role.name}`} />
    ) : (
        <span className="text-xs text-muted" aria-label="No actions available">
            —
        </span>
    )
}

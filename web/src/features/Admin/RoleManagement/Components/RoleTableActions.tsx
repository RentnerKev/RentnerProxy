import { ActionMenu } from '../../../../shared/ActionMenu'
import useTranslationStore from '../../../../language/useTranslationStore'
import { getRoleTableActionState } from '../Helpers/roleTableActions'
import type { RoleTableActionsProps } from '../Types/role-management-component-props.types'

export default function RoleTableActions(props: RoleTableActionsProps) {
    const { t } = useTranslationStore()
    const actionState = getRoleTableActionState(props, t)

    if (actionState.kind === 'protected') {
        return (
            <span className="inline-flex rounded-full bg-neutral px-2.5 py-1 text-[0.66rem] font-extrabold text-muted">
                {t('admin.roles.actions.protected')}
            </span>
        )
    }

    return actionState.items.length > 0 ? (
        <ActionMenu
            items={actionState.items}
            ariaLabel={t('admin.roles.actions.open', { name: props.role.name })}
        />
    ) : (
        <span className="text-xs text-muted" aria-label={t('admin.roles.actions.none')}>
            —
        </span>
    )
}

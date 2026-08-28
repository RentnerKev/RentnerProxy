import FormMessage from '../../../shared/Forms/FormMessage'
import ContentState from '../../../shared/Management/ContentState'
import PageHeader from '../../../shared/Management/PageHeader'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import EditUserPanel from './Components/EditUserPanel'
import InviteUserPanel from './Components/InviteUserPanel'
import UsersTable from './Components/UsersTable'
import useUserManagementLogic from './Hooks/useUserManagementLogic'
import type { UserManagementPageProps } from './Types/user-management-component-props.types'

export default function UserManagementPage({ permissions }: UserManagementPageProps) {
    const { state, handler } = useUserManagementLogic(permissions)

    return (
        <>
            <PageHeader
                eyebrow="Access directory"
                title="Users"
                description="Invite people, assign roles, and revoke every active session when access must end."
                action={
                    state.canCreate ? (
                        <button
                            type="button"
                            className={uiClassNames.button.primary}
                            onClick={handler.toggleInvite}
                        >
                            {state.showInvite ? 'Close invite' : 'Invite user'}
                        </button>
                    ) : undefined
                }
            />

            {state.showInvite ? (
                <InviteUserPanel
                    canAssignRoles={state.canAssignRoles}
                    roles={state.roles}
                    onClose={handler.closeInvite}
                />
            ) : null}
            {state.selectedUser ? (
                <EditUserPanel
                    key={state.selectedUser.id}
                    user={state.selectedUser}
                    roles={state.roles}
                    canAssignRoles={state.canAssignRoles}
                    onClose={handler.closeEditor}
                />
            ) : null}

            {state.disableResult && !state.disableResult.success ? (
                <FormMessage tone="error">{state.disableResult.message}</FormMessage>
            ) : null}

            {state.isPending ? (
                <ContentState
                    busy
                    title="Loading users"
                    description="Resolving users and assignable roles."
                />
            ) : state.isError ? (
                <ContentState
                    title="Users unavailable"
                    description="The access directory could not be loaded for this session."
                    action={
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            onClick={handler.retry}
                        >
                            Try again
                        </button>
                    }
                />
            ) : (
                <UsersTable
                    users={state.users}
                    canDisable={state.canDisable}
                    canUpdate={state.canUpdate}
                    isDisabling={state.isDisabling}
                    onDisable={handler.handleDisable}
                    onEdit={handler.openEditor}
                />
            )}
        </>
    )
}

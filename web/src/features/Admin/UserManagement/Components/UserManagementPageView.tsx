import FormMessage from '../../../../shared/Forms/FormMessage'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { UserManagementPageViewProps } from '../Types/user-management-page-view.types'
import UserFormModal from './UserFormModal'
import UsersTable from './UsersTable'

export default function UserManagementPageView({
    currentUserId,
    logic: { handler, state },
}: UserManagementPageViewProps) {
    return (
        <>
            <PageHeader
                eyebrow="Access directory"
                title="Users"
                description="Invite people, assign roles, and revoke every active session when access must end."
            />

            {state.successMessage ? (
                <div className="mb-4">
                    <FormMessage tone="success">{state.successMessage}</FormMessage>
                </div>
            ) : null}

            {state.isRolesError && state.canCreate ? (
                <div className="mb-4 flex flex-wrap items-center gap-3">
                    <FormMessage tone="error">
                        Role options are unavailable. User profile editing remains available.
                    </FormMessage>
                    <button
                        type="button"
                        className={uiClassNames.button.secondary}
                        onClick={handler.retryRoles}
                    >
                        Retry roles
                    </button>
                </div>
            ) : null}

            {state.isUsersError ? (
                <ContentState
                    title="Users unavailable"
                    description="The access directory could not be loaded for this session."
                    action={
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            onClick={handler.retryUsers}
                        >
                            Try again
                        </button>
                    }
                />
            ) : (
                <UsersTable
                    users={state.users}
                    actorIsOwner={state.actorIsOwner}
                    canCreate={state.canCreate}
                    canDisable={state.canDisable}
                    canUpdate={state.canUpdate}
                    createDisabled={state.isRolesPending || state.isRolesError}
                    currentUserId={currentUserId}
                    isLoading={state.isLoadingUsers}
                    onCreate={handler.openCreate}
                    onDisable={handler.openDisable}
                    onEdit={handler.openEditor}
                />
            )}

            {state.showCreate ? (
                <UserFormModal
                    open
                    mode="create"
                    currentUserId={currentUserId}
                    canAssignRoles={state.canAssignRoles}
                    roles={state.assignableRoles}
                    onCurrentUserChanged={handler.refreshCurrentUser}
                    onOpenChange={handler.setCreateOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}

            {state.selectedUser ? (
                <UserFormModal
                    key={state.selectedUser.id}
                    open
                    mode="edit"
                    currentUserId={currentUserId}
                    user={state.selectedUser}
                    canAssignRoles={state.canAssignRoles}
                    roles={state.assignableRoles}
                    onCurrentUserChanged={handler.refreshCurrentUser}
                    onOpenChange={handler.setEditorOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}

            {state.disableTarget ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setDisableOpen}
                    title="Disable user?"
                    description={
                        <>
                            <span className="block">
                                {state.disableTarget.displayName} will be unable to sign in.
                            </span>
                            <span className="mt-2 block">
                                Every active session and pending access token will be revoked.
                            </span>
                        </>
                    }
                    confirmLabel="Disable user"
                    pendingLabel="Disabling user…"
                    destructive
                    isPending={state.isDisabling}
                    errorMessage={state.disableError}
                    onConfirm={handler.confirmDisable}
                />
            ) : null}
        </>
    )
}

import FormMessage from '../../../../shared/Forms/FormMessage'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { UserManagementPageViewProps } from '../Types/user-management-page-view.types'
import UserFormModal from './UserFormModal'
import UsersTable from './UsersTable'
import useTranslationStore from '../../../../language/useTranslationStore'

export default function UserManagementPageView({
    currentUserId,
    logic: { handler, state },
}: UserManagementPageViewProps) {
    const { t } = useTranslationStore()

    return (
        <>
            <PageHeader
                eyebrow={t('admin.users.page.eyebrow')}
                title={t('admin.users.page.title')}
                description={t('admin.users.page.description')}
            />

            {state.isRolesError && state.canCreate ? (
                <div className="mb-4 flex flex-wrap items-center gap-3">
                    <FormMessage tone="error">
                        {t('admin.users.messages.rolesUnavailable')}
                    </FormMessage>
                    <button
                        type="button"
                        className={uiClassNames.button.secondary}
                        onClick={handler.retryRoles}
                    >
                        {t('admin.users.actions.retryRoles')}
                    </button>
                </div>
            ) : null}

            {state.isUsersError ? (
                <ContentState
                    title={t('admin.users.states.unavailableTitle')}
                    description={t('admin.users.states.unavailableDescription')}
                    action={
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            onClick={handler.retryUsers}
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : (
                <UsersTable
                    users={state.users}
                    actorIsOwner={state.actorIsOwner}
                    canCreate={state.canCreate}
                    canDisable={state.canDisable}
                    canEnable={state.canEnable}
                    canUpdate={state.canUpdate}
                    createDisabled={state.isRolesPending || state.isRolesError}
                    currentUserId={currentUserId}
                    enablingUserId={state.enablingUserId}
                    isLoading={state.isLoadingUsers}
                    onCreate={handler.openCreate}
                    onDisable={handler.openDisable}
                    onEnable={handler.enableUser}
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
                    title={t('admin.users.confirm.disableTitle')}
                    description={
                        <>
                            <span className="block">
                                {t('admin.users.confirm.disableDescription', {
                                    name: state.disableTarget.displayName,
                                })}
                            </span>
                            <span className="mt-2 block">
                                {t('admin.users.confirm.disableSessions')}
                            </span>
                        </>
                    }
                    confirmLabel={t('admin.users.actions.disable')}
                    pendingLabel={t('admin.users.actions.disabling')}
                    destructive
                    isPending={state.isDisabling}
                    onConfirm={handler.confirmDisable}
                />
            ) : null}
        </>
    )
}

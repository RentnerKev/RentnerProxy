import useUserManagementLogic from './Hooks/useUserManagementLogic.ts'
import type { UserManagementPageProps } from './Types/user-management-component-props.types.ts'
import FormMessage from '@/shared/Forms/FormMessage.tsx'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import UserFormModal from './Components/UserFormModal/index.tsx'
import UsersTable from './Components/UsersTable/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function UserManagementPage(props: UserManagementPageProps) {
    const { state, handler } = useUserManagementLogic(props)
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
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
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
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
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
                    currentUserId={props.currentUserId}
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
                    currentUserId={props.currentUserId}
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
                    currentUserId={props.currentUserId}
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

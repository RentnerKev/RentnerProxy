import FormMessage from '../../../../shared/Forms/FormMessage'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { RoleManagementPageViewProps } from '../Types/role-management-page-view.types'
import RoleFormModal from './RoleFormModal'
import RolesTable from './RolesTable'
import useTranslationStore from '../../../../language/useTranslationStore'

export default function RoleManagementPageView({
    currentUserRoleKeys,
    logic: { handler, state },
}: RoleManagementPageViewProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <PageHeader
                eyebrow={t('admin.roles.page.eyebrow')}
                title={t('admin.roles.page.title')}
                description={t('admin.roles.page.description')}
            />

            {state.successMessage ? (
                <div className="mb-4">
                    <FormMessage tone="success">{t(state.successMessage)}</FormMessage>
                </div>
            ) : null}

            {state.isError ? (
                <ContentState
                    title={t('admin.roles.states.unavailableTitle')}
                    description={t('admin.roles.states.unavailableDescription')}
                    action={
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            onClick={handler.retry}
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : (
                <RolesTable
                    roles={state.roles}
                    canCreate={state.canCreate}
                    canDelete={state.canDelete}
                    canUpdate={state.canUpdate}
                    isLoading={state.isLoading}
                    onCreate={handler.openCreate}
                    onDelete={handler.openDelete}
                    onEdit={handler.openEditor}
                />
            )}

            {state.showCreate ? (
                <RoleFormModal
                    open
                    mode="create"
                    currentUserRoleKeys={currentUserRoleKeys}
                    canAssignPermissions={state.canAssignPermissions}
                    assignablePermissionKeys={state.assignablePermissionKeys}
                    onCurrentUserChanged={handler.refreshCurrentUser}
                    onOpenChange={handler.setCreateOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}

            {state.selectedRole ? (
                <RoleFormModal
                    key={state.selectedRole.id}
                    open
                    mode="edit"
                    role={state.selectedRole}
                    currentUserRoleKeys={currentUserRoleKeys}
                    canAssignPermissions={state.canAssignPermissions}
                    assignablePermissionKeys={state.assignablePermissionKeys}
                    onCurrentUserChanged={handler.refreshCurrentUser}
                    onOpenChange={handler.setEditorOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}

            {state.deleteTarget ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setDeleteOpen}
                    title={t('admin.roles.confirm.deleteTitle')}
                    description={
                        <>
                            <span className="block">
                                {t('admin.roles.confirm.deleteDescription', {
                                    name: state.deleteTarget.name,
                                })}
                            </span>
                            <span className="mt-2 block">
                                {t('admin.roles.confirm.deleteWarning')}
                            </span>
                        </>
                    }
                    confirmLabel={t('admin.roles.actions.delete')}
                    pendingLabel={t('admin.roles.actions.deleting')}
                    destructive
                    isPending={state.isDeleting}
                    errorMessage={state.deleteError ? t(state.deleteError) : null}
                    onConfirm={handler.confirmDelete}
                />
            ) : null}
        </>
    )
}

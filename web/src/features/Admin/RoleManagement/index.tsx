import useRoleManagementLogic from './Hooks/useRoleManagementLogic.ts'
import type { RoleManagementPageProps } from './Types/role-management-component-props.types.ts'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import RoleFormModal from './Components/RoleFormModal/index.tsx'
import RolesTable from './Components/RolesTable/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function RoleManagementPage(props: RoleManagementPageProps) {
    const { state, handler } = useRoleManagementLogic(props)
    const { t } = useTranslationStore()
    return (
        <>
            <PageHeader
                eyebrow={t('admin.roles.page.eyebrow')}
                title={t('admin.roles.page.title')}
                description={t('admin.roles.page.description')}
            />

            {state.isError ? (
                <PageAlert
                    severity="error"
                    title={t('admin.roles.states.unavailableTitle')}
                    description={t('admin.roles.states.unavailableDescription')}
                    action={
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
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
                    currentUserRoleKeys={props.currentUserRoleKeys}
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
                    currentUserRoleKeys={props.currentUserRoleKeys}
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
                    onConfirm={handler.confirmDelete}
                />
            ) : null}
        </>
    )
}

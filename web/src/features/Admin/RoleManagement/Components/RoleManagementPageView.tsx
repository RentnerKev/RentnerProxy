import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
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

            {state.isError ? (
                <ContentState
                    title={t('admin.roles.states.unavailableTitle')}
                    description={t('admin.roles.states.unavailableDescription')}
                    action={
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
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
                    onConfirm={handler.confirmDelete}
                />
            ) : null}
        </>
    )
}

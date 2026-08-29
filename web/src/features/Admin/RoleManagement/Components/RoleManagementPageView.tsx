import FormMessage from '../../../../shared/Forms/FormMessage'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { RoleManagementPageViewProps } from '../Types/role-management-page-view.types'
import RoleFormModal from './RoleFormModal'
import RolesTable from './RolesTable'

export default function RoleManagementPageView({
    currentUserRoleKeys,
    logic: { handler, state },
}: RoleManagementPageViewProps) {
    return (
        <>
            <PageHeader
                eyebrow="Authorization"
                title="Roles"
                description="Compose custom permission sets while the owner, administrator, and viewer system roles stay protected."
            />

            {state.successMessage ? (
                <div className="mb-4">
                    <FormMessage tone="success">{state.successMessage}</FormMessage>
                </div>
            ) : null}

            {state.isError ? (
                <ContentState
                    title="Roles unavailable"
                    description="Role definitions could not be loaded for this session."
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
                    title="Delete role?"
                    description={
                        <>
                            <span className="block">
                                Are you sure you want to delete “{state.deleteTarget.name}”?
                            </span>
                            <span className="mt-2 block">This action cannot be undone.</span>
                        </>
                    }
                    confirmLabel="Delete role"
                    pendingLabel="Deleting role…"
                    destructive
                    isPending={state.isDeleting}
                    errorMessage={state.deleteError}
                    onConfirm={handler.confirmDelete}
                />
            ) : null}
        </>
    )
}

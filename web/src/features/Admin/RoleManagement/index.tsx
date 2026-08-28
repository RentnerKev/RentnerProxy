import FormMessage from '../../../shared/Forms/FormMessage'
import ContentState from '../../../shared/Management/ContentState'
import PageHeader from '../../../shared/Management/PageHeader'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import RoleEditor from './Components/RoleEditor'
import RolesTable from './Components/RolesTable'
import useRoleManagementLogic from './Hooks/useRoleManagementLogic'
import type { RoleManagementPageProps } from './Types/role-management-component-props.types'

export default function RoleManagementPage({ permissions }: RoleManagementPageProps) {
    const { state, handler } = useRoleManagementLogic(permissions)

    return (
        <>
            <PageHeader
                eyebrow="Authorization"
                title="Roles"
                description="Compose custom permission sets while the owner, administrator, and viewer system roles stay protected."
                action={
                    state.canCreate ? (
                        <button
                            type="button"
                            className={uiClassNames.button.primary}
                            onClick={handler.toggleCreateEditor}
                        >
                            {state.editorOpen && !state.selectedRole
                                ? 'Close editor'
                                : 'Create role'}
                        </button>
                    ) : undefined
                }
            />

            {state.editorOpen ? (
                <RoleEditor
                    key={state.selectedRole?.id ?? 'new-role'}
                    role={state.selectedRole}
                    canAssignPermissions={state.canAssignPermissions}
                    onClose={handler.closeEditor}
                />
            ) : null}

            {state.deleteResult && !state.deleteResult.success ? (
                <FormMessage tone="error">{state.deleteResult.message}</FormMessage>
            ) : null}

            {state.isPending ? (
                <ContentState
                    busy
                    title="Loading roles"
                    description="Resolving the permission registry."
                />
            ) : state.isError ? (
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
                    canDelete={state.canDelete}
                    canUpdate={state.canUpdate}
                    isDeleting={state.isDeleting}
                    onDelete={handler.handleDelete}
                    onEdit={handler.openEditor}
                />
            )}
        </>
    )
}

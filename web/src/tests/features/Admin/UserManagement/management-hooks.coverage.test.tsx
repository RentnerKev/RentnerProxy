// oxlint-disable no-await-in-loop -- Mutation outcomes share one mounted hook and must settle in order.
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import renderLogicHook from '@/tests/Helpers/renderLogicHook.tsx'
import { PERMISSIONS, SYSTEM_ROLES } from '@/config/permissions.config.ts'
import type { RoleManagementSummary, UserSummary } from '@/lib/Auth/Types/auth.types.ts'
import { toast } from '@rentnerkev/toasts'

const user: UserSummary = {
    id: 'user-1',
    email: 'user@example.com',
    displayName: 'User',
    profileImageVersion: null,
    status: 'active',
    roleKeys: [],
    createdAt: new Date(),
    updatedAt: new Date(),
}
const role: RoleManagementSummary = {
    id: 'role-1',
    key: 'editor',
    name: 'Editor',
    description: '',
    isSystem: false,
    permissionKeys: [PERMISSIONS.USERS_VIEW],
    userCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
}
const roles = [
    role,
    { ...role, id: 'owner', key: SYSTEM_ROLES.OWNER },
    { ...role, id: 'restricted', permissionKeys: [PERMISSIONS.ROLES_DELETE] },
]
const usersRead = mock(async () => [user])
const rolesRead = mock(async () => roles)
const result = { success: true, message: 'saved' }
const createUser = mock(async (_input: unknown) => result)
const updateUser = mock(async (_input: unknown) => result)
const createRole = mock(async (_input: unknown) => result)
const updateRole = mock(async (_input: unknown) => result)
const disable = mock(async (_input: unknown) => result)
const enable = mock(async (_input: unknown) => result)
const removeRole = mock(async (_input: unknown) => result)
const invalidateRouter = mock(async () => undefined)
mock.module('@tanstack/react-router', () => ({
    useRouter: () => ({ invalidate: invalidateRouter }),
}))
mock.module('@/features/Admin/UserManagement/middleware.ts', () => ({
    createUserHandler: createUser,
    updateUserHandler: updateUser,
    getUsersHandler: usersRead,
    disableUserHandler: disable,
    enableUserHandler: enable,
}))
mock.module('@/features/Admin/RoleManagement/middleware.ts', () => ({
    createRoleHandler: createRole,
    updateRoleHandler: updateRole,
    getRolesHandler: rolesRead,
    deleteRoleHandler: removeRole,
}))
const { default: useUsers } =
    await import('@/features/Admin/UserManagement/Hooks/useUserManagementLogic.ts')
const { default: useRoles } =
    await import('@/features/Admin/RoleManagement/Hooks/useRoleManagementLogic.ts')
const { default: useUserForm } =
    await import('@/features/Admin/UserManagement/Components/UserFormModal/Hooks/useUserFormModalLogic.ts')
const { default: useRoleForm } =
    await import('@/features/Admin/RoleManagement/Components/RoleFormModal/Hooks/useRoleFormModalLogic.ts')
const permissions = [
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_ASSIGN_ROLES,
    PERMISSIONS.ROLES_VIEW,
    PERMISSIONS.USERS_DISABLE,
    PERMISSIONS.USERS_ENABLE,
]
const { default: useUserTable } =
    await import('@/features/Admin/UserManagement/Components/UsersTable/Hooks/useUsersTableLogic.ts')
const { default: useRoleTable } =
    await import('@/features/Admin/RoleManagement/Components/RolesTable/Hooks/useRolesTableLogic.ts')
let dispose: (() => Promise<void>) | undefined
beforeEach(() => {
    for (const action of [createUser, updateUser, createRole, updateRole]) {
        action.mockReset()
        action.mockResolvedValue(result)
    }
    disable.mockReset()
    enable.mockReset()
    removeRole.mockReset()
    disable.mockResolvedValue(result)
    enable.mockResolvedValue(result)
    removeRole.mockResolvedValue(result)
    invalidateRouter.mockClear()
    usersRead.mockClear()
    rolesRead.mockClear()
    spyOn(toast, 'success').mockImplementation(() => '')
    spyOn(toast, 'error').mockImplementation(() => '')
})
afterEach(async () => {
    await dispose?.()
    dispose = undefined
    mock.restore()
})

test('user actions preserve dialog state on failed responses, invalidate on success and refresh a disabled self', async () => {
    const hook = await renderLogicHook(() =>
        useUsers({ currentUserId: user.id, currentUserRoleKeys: [], permissions }),
    )
    dispose = hook.dispose
    await hook.waitFor((value) => !value.state.isLoadingUsers && !value.state.isRolesPending)
    expect(hook.current.state.assignableRoles.map((value) => value.id)).toEqual([role.id])
    expect(hook.current.state.canCreate).toBe(true)
    await hook.run((value) => value.handler.confirmDisable())
    expect(disable).not.toHaveBeenCalled()
    await hook.run((value) => value.handler.openCreate())
    expect(hook.current.state.showCreate).toBe(true)
    await hook.run((value) => value.handler.openEditor(user))
    expect(hook.current.state.selectedUser).toEqual(user)
    await hook.run((value) => value.handler.setEditorOpen(true))
    expect(hook.current.state.selectedUser).toEqual(user)
    await hook.run((value) => value.handler.setEditorOpen(false))
    expect(hook.current.state.selectedUser).toBeNull()
    await hook.run((value) => value.handler.openDisable(user))
    disable.mockResolvedValueOnce({ success: false, message: 'denied' })
    await hook.run((value) => value.handler.confirmDisable())
    expect(hook.current.state.disableTarget).toEqual(user)
    expect(toast.error).toHaveBeenCalled()
    disable.mockRejectedValueOnce(new Error('transport unavailable'))
    await hook.run((value) => value.handler.confirmDisable())
    expect(hook.current.state.disableTarget).toEqual(user)
    const invalidation = spyOn(hook.client, 'invalidateQueries')
    await hook.run((value) => value.handler.confirmDisable())
    await hook.waitFor((value) => !value.state.isDisabling)
    expect(disable).toHaveBeenLastCalledWith({ data: { userId: user.id } })
    expect(hook.current.state.disableTarget).toBeNull()
    expect(invalidation).toHaveBeenCalled()
    expect(invalidateRouter).toHaveBeenCalledTimes(1)
    for (const outcome of ['failed', 'exception', 'success']) {
        if (outcome === 'failed')
            enable.mockResolvedValueOnce({ success: false, message: 'denied' })
        if (outcome === 'exception') enable.mockRejectedValueOnce(new Error('offline'))
        await hook.run((value) => value.handler.enableUser(user))
        await hook.waitFor((value) => value.state.enablingUserId === null)
    }
    expect(enable).toHaveBeenLastCalledWith({ data: { userId: user.id } })
    await hook.run((value) => {
        return value.handler.refreshCurrentUser()
    })
    await hook.run((value) => {
        value.handler.openDisable(user)
        value.handler.setDisableOpen(true)
    })
    await hook.run((value) => value.handler.setDisableOpen(false))
    expect(hook.current.state.disableTarget).toBeNull()
    await hook.run((value) => value.handler.handleFormSuccess())
    expect(hook.current.state.showCreate).toBe(false)
})

test('owner sees every assignable role while a viewer cannot start creation or fetch role assignments', async () => {
    const hook = await renderLogicHook(() =>
        useUsers({
            currentUserId: user.id,
            currentUserRoleKeys: [SYSTEM_ROLES.OWNER],
            permissions,
        }),
    )
    dispose = hook.dispose
    await hook.waitFor((value) => !value.state.isRolesPending)
    expect(hook.current.state.assignableRoles).toEqual(roles)
    await hook.dispose()
    dispose = undefined
    rolesRead.mockClear()
    const viewer = await renderLogicHook(() =>
        useUsers({
            currentUserId: user.id,
            currentUserRoleKeys: [],
            permissions: [PERMISSIONS.USERS_VIEW],
        }),
    )
    dispose = viewer.dispose
    expect(viewer.current.state.canCreate).toBe(false)
    expect(viewer.current.state.assignableRoles).toEqual([])
    expect(rolesRead).not.toHaveBeenCalled()
})

test('role deletion protects assigned/system roles and clears editor only after successful deletion', async () => {
    const hook = await renderLogicHook(() =>
        useRoles({
            currentUserRoleKeys: [],
            permissions: [
                PERMISSIONS.ROLES_VIEW,
                PERMISSIONS.ROLES_CREATE,
                PERMISSIONS.ROLES_ASSIGN_PERMISSIONS,
                PERMISSIONS.ROLES_DELETE,
            ],
        }),
    )
    dispose = hook.dispose
    await hook.waitFor((value) => !value.state.isLoading)
    await hook.run((value) => value.handler.confirmDelete())
    expect(removeRole).not.toHaveBeenCalled()
    await hook.run((value) => value.handler.openDelete({ ...role, isSystem: true }))
    expect(hook.current.state.deleteTarget).toBeNull()
    await hook.run((value) => value.handler.openDelete({ ...role, userCount: 1 }))
    expect(hook.current.state.deleteTarget).toBeNull()
    await hook.run((value) => value.handler.openCreate())
    expect(hook.current.state.showCreate).toBe(true)
    await hook.run((value) => value.handler.openEditor(role))
    await hook.run((value) => value.handler.setEditorOpen(true))
    expect(hook.current.state.selectedRole).toEqual(role)
    await hook.run((value) => value.handler.setEditorOpen(false))
    await hook.run((value) => value.handler.openDelete(role))
    removeRole.mockResolvedValueOnce({ success: false, message: 'denied' })
    await hook.run((value) => value.handler.confirmDelete())
    expect(hook.current.state.deleteTarget).toEqual(role)
    removeRole.mockRejectedValueOnce(new Error('offline'))
    await hook.run((value) => value.handler.confirmDelete())
    expect(toast.error).toHaveBeenCalled()
    await hook.run((value) => value.handler.confirmDelete())
    expect(removeRole).toHaveBeenLastCalledWith({ data: { roleId: role.id } })
    expect(hook.current.state.deleteTarget).toBeNull()
    await hook.run((value) => value.handler.openDelete(role))
    await hook.run((value) => value.handler.setDeleteOpen(true))
    await hook.run((value) => value.handler.setDeleteOpen(false))
    expect(hook.current.state.deleteTarget).toBeNull()
    await hook.run((value) => {
        value.handler.handleFormSuccess()
        return value.handler.refreshCurrentUser()
    })
    expect(hook.current.state.showCreate).toBe(false)
    expect(invalidateRouter).toHaveBeenCalled()
})

test('user form sends invitation roles and updates a current user only after successful persistence', async () => {
    const saved = mock(() => undefined)
    const refreshed = mock(async () => undefined)
    const create = await renderLogicHook(
        () =>
            useUserForm({
                canAssignRoles: true,
                currentUserId: user.id,
                mode: 'create',
                onCurrentUserChanged: refreshed,
                onSuccess: saved,
                roles,
            }),
        (value) => <form onSubmit={value.handler.handleSubmit} />,
    )
    dispose = create.dispose
    await create.run((value) => {
        value.form.setFieldValue('email', 'invite@example.com')
        value.form.setFieldValue('displayName', 'Invited')
        value.form.setFieldValue('roleKeys', [role.key])
    })
    await create.run(() =>
        create.container
            .querySelector('form')
            ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
    await create.waitFor((value) => !value.state.isPending && !value.form.state.isSubmitting)
    expect(createUser).toHaveBeenLastCalledWith({
        data: { displayName: 'Invited', email: 'invite@example.com', roleKeys: [role.key] },
    })
    expect(saved).toHaveBeenCalledTimes(1)
    expect(refreshed).not.toHaveBeenCalled()
    await create.dispose()
    dispose = undefined
    const edit = await renderLogicHook(
        () =>
            useUserForm({
                canAssignRoles: false,
                currentUserId: user.id,
                mode: 'edit',
                user: { ...user, roleKeys: [role.key] },
                onCurrentUserChanged: refreshed,
                onSuccess: saved,
                roles,
            }),
        (value) => <form onSubmit={value.handler.handleSubmit} />,
    )
    dispose = edit.dispose
    await edit.run((value) => value.form.setFieldValue('displayName', 'Renamed'))
    expect(edit.current.state.canEditRoles).toBe(false)
    const submit = () =>
        edit.run(() =>
            edit.container
                .querySelector('form')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        )
    updateUser.mockResolvedValueOnce({ success: false, message: 'denied' })
    await submit()
    await edit.waitFor((value) => !value.form.state.isSubmitting)
    expect(refreshed).not.toHaveBeenCalled()
    updateUser.mockRejectedValueOnce(new Error('offline'))
    await submit()
    await edit.waitFor((value) => !value.form.state.isSubmitting)
    expect(toast.error).toHaveBeenCalled()
    await submit()
    await edit.waitFor((value) => !value.form.state.isSubmitting)
    expect(updateUser).toHaveBeenLastCalledWith({
        data: { userId: user.id, email: user.email, displayName: 'Renamed' },
    })
    expect(refreshed).toHaveBeenCalledTimes(1)
    expect(saved).toHaveBeenCalledTimes(2)
})

test('role form sends permission assignments only when allowed and refreshes affected current sessions', async () => {
    const saved = mock(() => undefined)
    const refreshed = mock(async () => undefined)
    const create = await renderLogicHook(
        () =>
            useRoleForm({
                canAssignPermissions: true,
                assignablePermissionKeys: [PERMISSIONS.USERS_VIEW],
                currentUserRoleKeys: [],
                mode: 'create',
                onCurrentUserChanged: refreshed,
                onSuccess: saved,
            }),
        (value) => <form onSubmit={value.handler.handleSubmit} />,
    )
    dispose = create.dispose
    await create.run((value) => {
        value.form.setFieldValue('key', 'auditor')
        value.form.setFieldValue('name', 'Auditor')
        value.form.setFieldValue('description', 'Review access')
        value.form.setFieldValue('permissionKeys', [PERMISSIONS.USERS_VIEW])
    })
    await create.run(() =>
        create.container
            .querySelector('form')
            ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
    await create.waitFor((value) => !value.form.state.isSubmitting)
    expect(createRole).toHaveBeenLastCalledWith({
        data: {
            key: 'auditor',
            name: 'Auditor',
            description: 'Review access',
            permissionKeys: [PERMISSIONS.USERS_VIEW],
        },
    })
    expect(refreshed).not.toHaveBeenCalled()
    await create.dispose()
    dispose = undefined
    const edit = await renderLogicHook(
        () =>
            useRoleForm({
                canAssignPermissions: false,
                assignablePermissionKeys: [],
                currentUserRoleKeys: [role.key],
                mode: 'edit',
                role,
                onCurrentUserChanged: refreshed,
                onSuccess: saved,
            }),
        (value) => <form onSubmit={value.handler.handleSubmit} />,
    )
    dispose = edit.dispose
    expect(edit.current.state.canEditPermissions).toBe(false)
    await edit.run((value) => value.form.setFieldValue('name', 'Updated editor'))
    const submit = () =>
        edit.run(() =>
            edit.container
                .querySelector('form')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        )
    updateRole.mockResolvedValueOnce({ success: false, message: 'denied' })
    await submit()
    await edit.waitFor((value) => !value.form.state.isSubmitting)
    expect(refreshed).not.toHaveBeenCalled()
    updateRole.mockRejectedValueOnce(new Error('offline'))
    await submit()
    await edit.waitFor((value) => !value.form.state.isSubmitting)
    expect(toast.error).toHaveBeenCalled()
    await submit()
    await edit.waitFor((value) => !value.form.state.isSubmitting)
    expect(updateRole).toHaveBeenLastCalledWith({
        data: { roleId: role.id, name: 'Updated editor', description: '' },
    })
    expect(refreshed).toHaveBeenCalledTimes(1)
})

test('editable role assignments require the actor to possess every current role and permission', async () => {
    const saved = mock(() => undefined)
    const refreshed = mock(async () => undefined)
    const hidden = await renderLogicHook(() =>
        useUserForm({
            canAssignRoles: true,
            currentUserId: user.id,
            mode: 'edit',
            user: { ...user, roleKeys: ['hidden'] },
            onCurrentUserChanged: refreshed,
            onSuccess: saved,
            roles,
        }),
    )
    dispose = hidden.dispose
    expect(hidden.current.state.canEditRoles).toBe(false)
    await hidden.dispose()
    dispose = undefined
    const allowed = await renderLogicHook(() =>
        useUserForm({
            canAssignRoles: true,
            currentUserId: 'someone-else',
            mode: 'edit',
            user: { ...user, roleKeys: [role.key] },
            onCurrentUserChanged: refreshed,
            onSuccess: saved,
            roles,
        }),
    )
    dispose = allowed.dispose
    expect(allowed.current.state.canEditRoles).toBe(true)
    await allowed.run((value) => value.form.handleSubmit())
    expect(updateUser).toHaveBeenLastCalledWith({
        data: {
            userId: user.id,
            email: user.email,
            displayName: user.displayName,
            roleKeys: [role.key],
        },
    })
    await allowed.dispose()
    dispose = undefined
    const roleEditor = await renderLogicHook(() =>
        useRoleForm({
            canAssignPermissions: true,
            assignablePermissionKeys: [PERMISSIONS.USERS_VIEW],
            currentUserRoleKeys: [],
            mode: 'edit',
            role,
            onCurrentUserChanged: refreshed,
            onSuccess: saved,
        }),
    )
    dispose = roleEditor.dispose
    expect(roleEditor.current.state.canEditPermissions).toBe(true)
    await roleEditor.run((value) => value.form.handleSubmit())
    expect(updateRole).toHaveBeenLastCalledWith({
        data: {
            roleId: role.id,
            name: role.name,
            description: role.description,
            permissionKeys: [PERMISSIONS.USERS_VIEW],
        },
    })
    expect(refreshed).not.toHaveBeenCalled()
})

test('user and role tables search translated roles and permission keys and reset actual table filters', async () => {
    const users = [
        { ...user, roleKeys: [SYSTEM_ROLES.OWNER] },
        { ...user, id: 'user-2', email: 'audit@example.com', roleKeys: ['auditor'] },
    ]
    const userTable = await renderLogicHook(() =>
        useUserTable({
            users,
            actorIsOwner: true,
            canCreate: false,
            canDisable: false,
            canEnable: false,
            canUpdate: false,
            createDisabled: false,
            currentUserId: 'someone-else',
            enablingUserId: null,
            isLoading: false,
            onCreate: () => undefined,
            onDisable: () => undefined,
            onEnable: () => undefined,
            onEdit: () => undefined,
        }),
    )
    dispose = userTable.dispose
    await userTable.run((value) => value.table.setGlobalFilter('owner'))
    expect(userTable.current.table.getRowModel().rows.map((row) => row.id)).toEqual([user.id])
    await userTable.run((value) => value.table.setGlobalFilter('no-such-account'))
    expect(userTable.current.table.getRowModel().rows).toHaveLength(0)
    await userTable.run((value) => value.handler.handleResetFilters())
    expect(userTable.current.table.getRowModel().rows).toHaveLength(2)
    await userTable.run((value) => value.handler.toggleColumnFilters())
    expect(userTable.current.state.showColumnFilters).toBe(true)
    await userTable.dispose()
    dispose = undefined
    const rolesTable = await renderLogicHook(() =>
        useRoleTable({
            roles: [
                role,
                {
                    ...role,
                    id: 'role-2',
                    key: SYSTEM_ROLES.VIEWER,
                    isSystem: true,
                    permissionKeys: [PERMISSIONS.ROLES_VIEW],
                },
            ],
            canCreate: false,
            canDelete: false,
            canUpdate: false,
            isLoading: false,
            onCreate: () => undefined,
            onDelete: () => undefined,
            onEdit: () => undefined,
        }),
    )
    dispose = rolesTable.dispose
    await rolesTable.run((value) => value.table.setGlobalFilter(PERMISSIONS.USERS_VIEW))
    expect(rolesTable.current.table.getRowModel().rows.map((row) => row.id)).toEqual([role.id])
    await rolesTable.run((value) => value.table.setGlobalFilter('no-such-role'))
    expect(rolesTable.current.table.getRowModel().rows).toHaveLength(0)
    await rolesTable.run((value) => value.handler.handleResetFilters())
    expect(rolesTable.current.table.getRowModel().rows).toHaveLength(2)
    await rolesTable.run((value) => value.handler.toggleColumnFilters())
    expect(rolesTable.current.state.showColumnFilters).toBe(true)
})

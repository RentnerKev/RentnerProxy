import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import UserManagementPage from '../../features/Admin/UserManagement'
import { requirePermissionRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_authenticated/users')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.USERS_VIEW),
    component: UsersRoute,
})

function UsersRoute() {
    const { user } = Route.useRouteContext()
    return (
        <UserManagementPage
            currentUserId={user.id}
            currentUserRoleKeys={user.roles}
            permissions={user.permissions}
        />
    )
}

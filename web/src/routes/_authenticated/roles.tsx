import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import RoleManagementPage from '../../features/Admin/RoleManagement'
import { requirePermissionRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_authenticated/roles')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.ROLES_VIEW),
    component: RolesRoute,
})

function RolesRoute() {
    const { user } = Route.useRouteContext()
    return <RoleManagementPage currentUserRoleKeys={user.roles} permissions={user.permissions} />
}

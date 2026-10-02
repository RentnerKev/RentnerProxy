import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import RoleManagementPage from '@/features/Admin/RoleManagement/index.tsx'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_authenticated/roles')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.ROLES_VIEW),
    component: RolesRoute,
})

function RolesRoute() {
    const { user } = Route.useRouteContext()
    return <RoleManagementPage currentUserRoleKeys={user.roles} permissions={user.permissions} />
}

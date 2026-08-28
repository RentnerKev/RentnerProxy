import { createFileRoute, redirect } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import RoleManagementPage from '../../features/Admin/RoleManagement'

export const Route = createFileRoute('/_authenticated/roles')({
    beforeLoad: ({ context }) => {
        if (!context.user.permissions.includes(PERMISSIONS.ROLES_VIEW)) {
            throw redirect({ to: '/' })
        }
    },
    component: RolesRoute,
})

function RolesRoute() {
    const { user } = Route.useRouteContext()
    return <RoleManagementPage permissions={user.permissions} />
}

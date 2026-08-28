import { createFileRoute, redirect } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import UserManagementPage from '../../features/Admin/UserManagement'

export const Route = createFileRoute('/_authenticated/users')({
    beforeLoad: ({ context }) => {
        if (!context.user.permissions.includes(PERMISSIONS.USERS_VIEW)) {
            throw redirect({ to: '/' })
        }
    },
    component: UsersRoute,
})

function UsersRoute() {
    const { user } = Route.useRouteContext()
    return <UserManagementPage permissions={user.permissions} />
}

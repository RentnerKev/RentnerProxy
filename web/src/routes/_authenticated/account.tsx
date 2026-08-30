import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import UserSettingsPage from '../../features/UserSettings'
import { requirePermissionRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_authenticated/account')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.ACCOUNT_VIEW),
    component: AccountRoute,
})

function AccountRoute() {
    const { user } = Route.useRouteContext()

    return <UserSettingsPage user={user} />
}

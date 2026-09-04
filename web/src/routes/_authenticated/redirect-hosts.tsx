import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '../../config/permissions.config'
import RedirectHostManagementPage from '../../features/Admin/RedirectHostManagement'
import { requirePermissionRoute } from '../../features/Auth/route-guards'
export const Route = createFileRoute('/_authenticated/redirect-hosts')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.REDIRECT_HOSTS_VIEW),
    component: RedirectHostsRoute,
})
function RedirectHostsRoute() {
    const { user } = Route.useRouteContext()
    return <RedirectHostManagementPage permissions={user.permissions} />
}

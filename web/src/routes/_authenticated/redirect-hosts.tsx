import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import RedirectHostManagementPage from '@/features/Admin/RedirectHostManagement/index.tsx'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'
export const Route = createFileRoute('/_authenticated/redirect-hosts')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.REDIRECT_HOSTS_VIEW),
    component: RedirectHostsRoute,
})
function RedirectHostsRoute() {
    const { user } = Route.useRouteContext()
    return <RedirectHostManagementPage permissions={user.permissions} />
}

import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import ProxyHostManagementPage from '../../features/Admin/ProxyHostManagement'
import { requirePermissionRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_authenticated/proxy-hosts')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.PROXY_HOSTS_VIEW),
    component: ProxyHostsRoute,
})

function ProxyHostsRoute() {
    const { user } = Route.useRouteContext()
    return <ProxyHostManagementPage permissions={user.permissions} />
}

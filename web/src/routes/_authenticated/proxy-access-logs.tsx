import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import ProxyAccessLogsPage from '@/features/Admin/ProxyAccessLogs/index.tsx'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_authenticated/proxy-access-logs')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.PROXY_ACCESS_LOGS_VIEW),
    component: ProxyAccessLogsRoute,
})

function ProxyAccessLogsRoute() {
    const { user } = Route.useRouteContext()
    return <ProxyAccessLogsPage permissions={user.permissions} />
}

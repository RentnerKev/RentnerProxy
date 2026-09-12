import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import AuditLogsPage from '../../features/Admin/AuditLogs'
import { requirePermissionRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_authenticated/audit-logs')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.AUDIT_LOGS_VIEW),
    component: AuditLogsRoute,
})

function AuditLogsRoute() {
    const { user } = Route.useRouteContext()
    return <AuditLogsPage permissions={user.permissions} />
}

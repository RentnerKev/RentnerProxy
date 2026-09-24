import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import SecurityDashboardPage from '../../features/Admin/CrowdSec/Components/SecurityDashboardPage'
import { requirePermissionRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_authenticated/security')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.CROWDSEC_VIEW),
    component: SecurityDashboardPage,
})

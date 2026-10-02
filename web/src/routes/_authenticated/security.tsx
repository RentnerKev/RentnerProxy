import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import SecurityDashboardPage from '@/features/Admin/CrowdSec/Components/SecurityDashboardPage/index.tsx'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_authenticated/security')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.CROWDSEC_VIEW),
    component: SecurityDashboardPage,
})

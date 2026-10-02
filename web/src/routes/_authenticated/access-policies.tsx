import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import AccessPolicyManagementPage from '@/features/Admin/AccessPolicyManagement/index.tsx'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_authenticated/access-policies')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.ACCESS_POLICIES_VIEW),
    component: AccessPoliciesRoute,
})

function AccessPoliciesRoute() {
    const { user } = Route.useRouteContext()
    return <AccessPolicyManagementPage permissions={user.permissions} />
}

import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import AccessPolicyManagementPage from '../../features/Admin/AccessPolicyManagement'
import { requirePermissionRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_authenticated/access-policies')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.ACCESS_POLICIES_VIEW),
    component: AccessPoliciesRoute,
})

function AccessPoliciesRoute() {
    const { user } = Route.useRouteContext()
    return <AccessPolicyManagementPage permissions={user.permissions} />
}

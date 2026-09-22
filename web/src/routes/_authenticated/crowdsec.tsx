import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import CrowdSecPage from '../../features/Admin/CrowdSec'
import { requirePermissionRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_authenticated/crowdsec')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.CROWDSEC_VIEW),
    component: CrowdSecRoute,
})

function CrowdSecRoute() {
    const { user } = Route.useRouteContext()
    return <CrowdSecPage permissions={user.permissions} />
}

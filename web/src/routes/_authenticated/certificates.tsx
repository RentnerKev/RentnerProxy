import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '../../config/permissions.config'
import CertificateManagementPage from '../../features/Admin/CertificateManagement'
import { requirePermissionRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_authenticated/certificates')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.CERTIFICATES_VIEW),
    component: CertificatesRoute,
})

function CertificatesRoute() {
    const { user } = Route.useRouteContext()
    return <CertificateManagementPage permissions={user.permissions} />
}

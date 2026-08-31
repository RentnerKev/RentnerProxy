import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '../../config/permissions.config'
import CertificateManagementPage from '../../features/Admin/CertificateManagement'

export const Route = createFileRoute('/_authenticated/certificates')({
    beforeLoad: ({ context }) => {
        const permissions = context.user.permissions
        if (
            !permissions.includes(PERMISSIONS.CERTIFICATES_VIEW) &&
            !permissions.includes(PERMISSIONS.TRUSTED_CAS_VIEW)
        ) {
            throw redirect({ to: '/' })
        }
    },
    component: CertificatesRoute,
})

function CertificatesRoute() {
    const { user } = Route.useRouteContext()
    return <CertificateManagementPage permissions={user.permissions} />
}

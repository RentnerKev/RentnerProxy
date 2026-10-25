import { createFileRoute, redirect } from '@tanstack/react-router'
import { certificateDetailsSearchSchema } from '@/features/Admin/CertificateManagement/validation.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import CertificateManagementPage from '@/features/Admin/CertificateManagement/index.tsx'

export const Route = createFileRoute('/_authenticated/certificates')({
    validateSearch: (search) => certificateDetailsSearchSchema.parse(search),
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
    const { selectedCertificateId } = Route.useSearch()
    return (
        <CertificateManagementPage
            permissions={user.permissions}
            selectedCertificateId={selectedCertificateId}
        />
    )
}

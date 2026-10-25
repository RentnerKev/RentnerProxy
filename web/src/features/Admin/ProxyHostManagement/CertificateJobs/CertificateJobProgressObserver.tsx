import ManualDnsJobAlert from './ManualDnsJobAlert.tsx'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import useCertificateJobProgressObserver from '../Hooks/useCertificateJobProgressObserver.ts'

export default function CertificateJobProgressObserver({
    permissions,
}: {
    readonly permissions: readonly PermissionKey[]
}) {
    const { state } = useCertificateJobProgressObserver(permissions)
    return (
        <>
            {state.manualJobs.map((job) => (
                <ManualDnsJobAlert
                    key={job.id}
                    message={job.domains.join(', ')}
                    certificateId={job.certificateId!}
                    canViewCertificate={state.canViewCertificate}
                />
            ))}
        </>
    )
}

import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import useCertificateJobProgressObserver from '../Hooks/useCertificateJobProgressObserver.ts'

export default function CertificateJobProgressObserver({
    permissions,
}: {
    readonly permissions: readonly PermissionKey[]
}) {
    useCertificateJobProgressObserver(permissions)
    return null
}

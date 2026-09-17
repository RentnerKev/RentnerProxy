import type { PermissionKey } from '../../../../config/permissions.config'
import useCertificateJobProgressObserver from '../Hooks/useCertificateJobProgressObserver'

export default function CertificateJobProgressObserver({
    permissions,
}: {
    readonly permissions: readonly PermissionKey[]
}) {
    useCertificateJobProgressObserver(permissions)
    return null
}

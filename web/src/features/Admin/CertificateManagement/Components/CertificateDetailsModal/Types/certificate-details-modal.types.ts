import type { CertificateSummary } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'

export interface CertificateDetailsModalProps {
    readonly certificate: CertificateSummary
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
}

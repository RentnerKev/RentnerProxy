import type { CertificateSummary } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'

export interface CertificateDetailsModalProps {
    readonly certificate: CertificateSummary
    readonly canIssue?: boolean
    readonly canRenew?: boolean
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
}

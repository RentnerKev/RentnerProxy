import type { CertificateSummary } from '@/shared/Types/certificates.types.ts'

export interface CertificateDetailsModalProps {
    readonly certificate: CertificateSummary
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
}

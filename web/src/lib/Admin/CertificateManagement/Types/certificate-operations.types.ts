import type {
    CertificateOperationKind,
    CertificateOperationStage,
} from '@/config/Types/certificates-config.types.ts'

import type { CertificateSummary } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'

export interface CertificateSchedulingDates {
    readonly nextRenewalAt: Date | null
    readonly nextAttemptAt: Date | null
    readonly lastAttemptAt: Date | null
    readonly lastSuccessAt: Date | null
    readonly lastActivatedAt: Date | null
    readonly lastErrorAt: Date | null
}

export interface CertificateOperationDisplay {
    readonly id: string | null
    readonly kind: CertificateOperationKind | null
    readonly stage: CertificateOperationStage | null
}

export type CertificateSummaryWithLegacyScheduling = CertificateSummary & {
    readonly schedulingDates?: Partial<CertificateSchedulingDates> | null
}

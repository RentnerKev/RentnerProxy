import type {
    CertificateJobErrorCode,
    CertificateJobStage,
} from '../../../config/Types/certificate-jobs-config.types.ts'
import type { CertificateOperationStage } from '../../../config/Types/certificates-config.types.ts'

export interface CertificateJobSummary {
    readonly id: string
    readonly proxyHostId: string | null
    readonly certificateId: string | null
    readonly domains: readonly string[]
    readonly stage: CertificateJobStage
    readonly controllerStage: CertificateOperationStage | null
    readonly lastErrorCode: CertificateJobErrorCode | null
    readonly createdAt: Date
    readonly updatedAt: Date
}

export type CertificateJobActionResult =
    | { readonly success: true; readonly message: string; readonly job: CertificateJobSummary }
    | { readonly success: false; readonly message: string }

import type { CertificateSummary } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import type { getAccessPolicyAvailability } from '@/lib/Admin/AccessPolicyManagement/basicAuthPolicyState.ts'

export interface ProxyHostFormFieldsLogicResult {
    readonly state: {
        readonly usableCertificates: readonly CertificateSummary[]
        readonly availability: ReturnType<typeof getAccessPolicyAvailability> | null
        readonly usable: boolean
    }
    readonly handler: {
        readonly handleSchemeChange: (value: string) => void
        readonly handleCertificateChange: (value: string) => void
    }
}

export interface UpstreamTlsFieldsLogicResult {
    readonly handler: {
        readonly handleVerifyChange: (checked: boolean) => void
    }
    readonly state: {
        readonly visible: boolean
        readonly verifying: boolean
        readonly isIp: boolean
        readonly normalizedHost: string | null
        readonly selectedIsMissing: boolean
    }
}

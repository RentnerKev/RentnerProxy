import type useManualDnsReadOnlyCheck from '../../../../Hooks/useManualDnsReadOnlyCheck.ts'
import type { ManualDnsChallengeMetadata } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'

export interface ManualDnsSetupGuideProps {
    readonly dnsCheck?: ReturnType<typeof useManualDnsReadOnlyCheck>
    readonly open: boolean
    readonly preparing: boolean
    readonly loading: boolean
    readonly loadFailed: boolean
    readonly blocked: boolean
    readonly complete: boolean
    readonly recordsReady: boolean
    readonly records: ManualDnsChallengeMetadata['records']
    readonly expiresAt: string | null
    readonly onOpenChange: (open: boolean) => void
    readonly onRetry: () => void
    readonly onDone: () => void
    readonly onCopy: (value: string) => void | Promise<void>
}

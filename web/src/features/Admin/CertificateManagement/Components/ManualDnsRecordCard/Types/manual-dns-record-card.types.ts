import type { ManualDnsChallengeMetadata } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'

export interface ManualDnsRecordCardProps {
    readonly record: ManualDnsChallengeMetadata['records'][number]
    readonly idPrefix: string
    readonly index: number
    readonly onCopy: (value: string) => void | Promise<void>
}

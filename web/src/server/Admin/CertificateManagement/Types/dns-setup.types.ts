import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type { ManualDnsChallengeMetadata } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import type {
    DnsSetupInput,
    DnsSetupResult,
    ManualDnsCheckInput,
    ManualDnsCheckResult,
} from '@/lib/Admin/CertificateManagement/Types/dns-setup.types.ts'

export interface CertificateDnsSetupDependencies {
    readonly currentUser: () => Promise<Pick<AuthenticatedUser, 'id' | 'permissions'>>
    readonly assertSetupAccess: (actorId: string) => Promise<void>
    readonly assertManualAccess: (
        actorId: string,
        input: ManualDnsCheckInput,
    ) => Promise<ManualDnsChallengeMetadata>
    readonly limit: (actorId: string) => Promise<void>
    readonly controller: {
        readonly setup: (input: DnsSetupInput) => Promise<DnsSetupResult>
        readonly check: (input: ManualDnsCheckInput) => Promise<ManualDnsCheckResult>
    }
}

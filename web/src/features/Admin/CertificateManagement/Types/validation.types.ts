import type { z } from 'zod'
import type { DnsProviderId } from '@/lib/DnsConnections/Types/dns-provider.types.ts'

import type {
    importCertificateInputSchema,
    replaceCertificateInputSchema,
    requestCertificateInputSchema,
} from '../validation.ts'

export interface CertificateRequestFormValues {
    readonly name: string
    readonly domains: string[]
    readonly environment: string
    readonly challengeType: string
    readonly dnsMode?: string | undefined
    readonly dnsZoneId: string
    readonly dnsApiToken: string
    readonly dnsConnectionId?: string | undefined
    readonly dnsConnectionProvider?: DnsProviderId | undefined
    readonly contactEmail: string
    readonly acceptTerms: boolean
}

export type ImportCertificateInput = z.input<typeof importCertificateInputSchema>

export type ReplaceCertificateInput = z.input<typeof replaceCertificateInputSchema>

export type RequestCertificateInput = z.input<typeof requestCertificateInputSchema>

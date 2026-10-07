import type { PUBLISHED_RELEASES } from '../published-releases.ts'

export interface PublishedRelease {
    readonly version: string
    readonly image: string
    readonly digest: string
    readonly revision: string
    readonly migrationCount: number
    readonly schemaTables: number
    readonly schemaSha256: string
    readonly capabilities: {
        readonly accessPolicies: boolean
        readonly basicAuth: boolean
        readonly ipRules: boolean
        readonly certificateCandidates: boolean
        readonly durableCertificateOperations: boolean
        readonly certificateBindingJobs: boolean
        readonly auditEvents: boolean
    }
}

export type PublishedReleaseKey = keyof typeof PUBLISHED_RELEASES

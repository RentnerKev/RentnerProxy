import type { PUBLISHED_ALPHAS } from '../published-alphas.ts'

export interface PublishedAlphaRelease {
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

export type PublishedAlphaKey = keyof typeof PUBLISHED_ALPHAS

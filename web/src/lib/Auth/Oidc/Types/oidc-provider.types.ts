import type { z } from 'zod'
import type {
    oidcProviderSchema,
    saveOidcProvidersSchema,
    testOidcProviderSchema,
} from '../validation.ts'

export type OidcProviderConfiguration = z.infer<typeof oidcProviderSchema>
export type SaveOidcProvidersInput = z.infer<typeof saveOidcProvidersSchema>
export interface OidcProviderSummary extends OidcProviderConfiguration {
    readonly revision: number
    readonly credentialConfigured: boolean
}
export type TestOidcProviderInput = z.infer<typeof testOidcProviderSchema>
export interface OidcProviderTestResult {
    readonly status: 'metadata_verified'
    readonly callbackUrl: string
}
export interface OidcProvidersSummary {
    readonly callbackUrl?: string | null
    readonly revision: number
    readonly providers: OidcProviderSummary[]
}

/** Durable session provenance contains no tokens, credentials or group claims. */
export interface OidcSessionProof {
    readonly providerId: string
    readonly providerRevision: number
    readonly bindingGeneration?: number | undefined
    readonly issuer: string
    readonly subject: string
    readonly userId: string
    readonly expiresAt: number
}

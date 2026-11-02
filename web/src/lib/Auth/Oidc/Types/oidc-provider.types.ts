import type { z } from 'zod'
import type { oidcProviderSchema, saveOidcProvidersSchema } from '../validation.ts'

export type OidcProviderConfiguration = z.infer<typeof oidcProviderSchema>
export type SaveOidcProvidersInput = z.infer<typeof saveOidcProvidersSchema>
export interface OidcProviderSummary extends OidcProviderConfiguration {
    readonly revision: number
    readonly credentialConfigured: boolean
}
export interface OidcProvidersSummary {
    readonly revision: number
    readonly providers: OidcProviderSummary[]
}

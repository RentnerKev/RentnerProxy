import { z } from 'zod'
import { oidcProviderSchema } from '@/lib/Auth/Oidc/validation.ts'
import type { OidcProviderSummary } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import type { ProviderDraft } from './Types/oidc-providers.types.ts'

export function providerDraft(provider?: OidcProviderSummary): ProviderDraft {
    return {
        id: provider?.id ?? crypto.randomUUID(),
        name: provider?.name ?? '',
        enabled: provider?.enabled ?? false,
        issuer: provider?.issuer ?? '',
        clientId: provider?.clientId ?? '',
        clientSecret: '',
        tokenEndpointAuthMethod: provider?.tokenEndpointAuthMethod ?? 'client_secret_basic',
        endpointOrigins: provider?.allowedEndpointOrigins.join('\n') ?? '',
        privateCidrs: provider?.allowedPrivateCidrs.join('\n') ?? '',
        bindings:
            provider?.bindings.map((binding) => ({ ...binding, rowId: crypto.randomUUID() })) ?? [],
    }
}
const lines = (value: string) =>
    value
        .split(/[,\n]/u)
        .map((line) => line.trim())
        .filter(Boolean)
export function providerInput(draft: ProviderDraft) {
    const { endpointOrigins, privateCidrs, clientSecret, bindings, ...provider } = draft
    let issuerOrigin = ''
    try {
        issuerOrigin = new URL(draft.issuer).origin
    } catch {}
    return {
        ...provider,
        bindings: bindings.map(({ rowId: _rowId, ...binding }) => binding),
        allowedEndpointOrigins: lines(endpointOrigins || issuerOrigin),
        allowedPrivateCidrs: lines(privateCidrs),
        ...(clientSecret ? { clientSecret } : {}),
    }
}

export const providerSummarySchema = oidcProviderSchema.safeExtend({
    revision: z.number().int().nonnegative(),
    credentialConfigured: z.boolean(),
})
export const providersResponseSchema = z
    .object({
        revision: z.number().int().nonnegative(),
        callbackUrl: z.url().nullable().optional(),
        providers: z.array(providerSummarySchema),
    })
    .strict()
export const providerTestResponseSchema = z
    .object({ status: z.literal('metadata_verified'), callbackUrl: z.url() })
    .strict()

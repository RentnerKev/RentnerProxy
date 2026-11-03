import { z } from 'zod'
import { oidcProviderSchema } from '@/lib/Auth/Oidc/validation.ts'
import { createOidcProviderId } from '@/lib/Auth/Oidc/providerId.ts'
import type { OidcProviderSummary } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import type { ProviderAccountPolicyDraft, ProviderDraft } from './Types/oidc-providers.types.ts'

/** Matches the backend's opt-in defaults without enabling provisioning for legacy providers. */
export function accountPolicyDraft(
    policy?: OidcProviderSummary['accountPolicy'],
): ProviderAccountPolicyDraft {
    return {
        provisioning: policy?.provisioning ?? false,
        groupClaim: policy?.groupClaim ?? 'groups',
        defaultRoleKeys: [...(policy?.defaultRoleKeys ?? [])],
        groupRoleMappings:
            policy?.groupRoleMappings.map((mapping) => ({
                ...mapping,
                roleKeys: [...mapping.roleKeys],
                rowId: createOidcProviderId(),
            })) ?? [],
    }
}

/** Copies editable policy into an isolated draft; stored credentials never populate the form. */
export function providerDraft(provider?: OidcProviderSummary): ProviderDraft {
    return {
        id: provider?.id ?? createOidcProviderId(),
        name: provider?.name ?? '',
        enabled: provider?.enabled ?? false,
        issuer: provider?.issuer ?? '',
        clientId: provider?.clientId ?? '',
        clientSecret: '',
        tokenEndpointAuthMethod: provider?.tokenEndpointAuthMethod ?? 'client_secret_basic',
        endpointOrigins: provider?.allowedEndpointOrigins.join('\n') ?? '',
        privateCidrs: provider?.allowedPrivateCidrs.join('\n') ?? '',
        ...(provider?.accountPolicy
            ? { accountPolicy: accountPolicyDraft(provider.accountPolicy) }
            : {}),
        bindings:
            provider?.bindings.map((binding) => ({ ...binding, rowId: createOidcProviderId() })) ??
            [],
    }
}
const lines = (value: string) =>
    value
        .split(/[,\n]/u)
        .map((line) => line.trim())
        .filter(Boolean)
/** Removes UI row identities and omits blank secrets so unchanged provider trust retains its credential. */
export function providerInput(draft: ProviderDraft) {
    const { endpointOrigins, privateCidrs, clientSecret, bindings, accountPolicy, ...provider } =
        draft
    let issuerOrigin = ''
    try {
        issuerOrigin = new URL(draft.issuer).origin
    } catch {}
    const origins = lines(endpointOrigins)
    return {
        ...provider,
        ...(accountPolicy
            ? {
                  accountPolicy: {
                      ...accountPolicy,
                      groupRoleMappings: accountPolicy.groupRoleMappings.map(
                          ({ rowId: _rowId, ...mapping }) =>
                              Object.assign({}, mapping, { roleKeys: [...mapping.roleKeys] }),
                      ),
                  },
              }
            : {}),
        bindings: bindings.map(({ rowId: _rowId, ...binding }) => binding),
        allowedEndpointOrigins: origins.length > 0 ? origins : lines(issuerOrigin),
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

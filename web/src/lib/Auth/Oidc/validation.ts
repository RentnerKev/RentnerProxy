import { z } from 'zod'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'

export const oidcHttpsUrlSchema = z
    .string()
    .max(OIDC_LIMITS.urlLength)
    .refine((value) => {
        try {
            const url = new URL(value)
            return (
                value.startsWith('https://') &&
                !/[\s\\]/u.test(value) &&
                !Array.from(value).some(
                    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
                ) &&
                !value.includes('?') &&
                !value.includes('#') &&
                !value.split('://')[1]?.split('/')[0]?.includes('@') &&
                url.protocol === 'https:' &&
                !!url.hostname &&
                !url.username &&
                !url.password
            )
        } catch {
            return false
        }
    })

export const oidcEndpointOriginSchema = oidcHttpsUrlSchema.refine((value) => {
    try {
        return new URL(value).origin === value
    } catch {
        return false
    }
})
export const oidcBindingSchema = z
    .object({
        subject: z.string().regex(/^[\x21-\x7e]{1,255}$/u),
        userId: z.uuid(),
    })
    .strict()

export const oidcProviderSchema = z
    .object({
        id: z.uuid(),
        name: z.string().trim().min(1).max(100),
        enabled: z.boolean(),
        issuer: oidcHttpsUrlSchema,
        clientId: z.string().min(1).max(255),
        tokenEndpointAuthMethod: z.enum(['client_secret_basic', 'client_secret_post']),
        allowedEndpointOrigins: z
            .array(oidcEndpointOriginSchema)
            .min(1)
            .max(OIDC_LIMITS.endpointOrigins),
        allowedPrivateCidrs: z.array(z.string().min(1).max(64)).max(OIDC_LIMITS.privateCidrs),
        bindings: z.array(oidcBindingSchema).max(OIDC_LIMITS.bindings),
    })
    .strict()
    .superRefine((value, context) => {
        let issuerOrigin: string
        try {
            issuerOrigin = new URL(value.issuer).origin
        } catch {
            context.addIssue({ code: 'custom', message: 'Invalid issuer URL.' })
            return
        }
        if (
            !value.allowedEndpointOrigins.includes(issuerOrigin) ||
            new Set(value.allowedEndpointOrigins).size !== value.allowedEndpointOrigins.length ||
            new Set(value.allowedPrivateCidrs).size !== value.allowedPrivateCidrs.length ||
            new Set(value.bindings.map((binding) => binding.subject)).size !== value.bindings.length
        )
            context.addIssue({
                code: 'custom',
                message: 'Invalid provider trust or binding configuration.',
            })
    })

export const saveOidcProvidersSchema = z
    .object({
        expectedRevision: z
            .number()
            .int()
            .min(0)
            .max(Number.MAX_SAFE_INTEGER - 1),
        providers: z
            .array(
                oidcProviderSchema.safeExtend({ clientSecret: z.string().max(2_048).optional() }),
            )
            .max(OIDC_LIMITS.providers),
    })
    .strict()
    .superRefine((value, context) => {
        const identities = value.providers.flatMap((provider) =>
            provider.bindings.map((binding) => JSON.stringify([provider.issuer, binding.subject])),
        )
        if (
            new Set(value.providers.map((provider) => provider.id)).size !==
                value.providers.length ||
            new Set(identities).size !== identities.length
        )
            context.addIssue({ code: 'custom', message: 'Duplicate provider or identity.' })
    })

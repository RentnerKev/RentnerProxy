import { z } from 'zod'
import { DNS_PROVIDER_IDS, MAX_DNS_PROVIDERS } from '@/config/dns-connections.config.ts'

export const dnsProviderIdSchema = z.enum(DNS_PROVIDER_IDS)
export const dnsProviderDescriptorSchema = z.strictObject({
    id: dnsProviderIdSchema,
    capabilities: z.strictObject({
        zoneDiscovery: z.boolean(),
        txtCreate: z.boolean(),
        txtCleanup: z.boolean(),
        addressRecordTypes: z
            .array(z.enum(['A', 'AAAA']))
            .max(2)
            .refine((values) => new Set(values).size === values.length),
        proxyOptions: z.enum(['none', 'cloudflare']),
    }),
})

export const dnsProviderCatalogSchema = z.strictObject({
    providers: z
        .array(dnsProviderDescriptorSchema)
        .min(1)
        .max(MAX_DNS_PROVIDERS)
        .refine(
            (providers) =>
                new Set(providers.map((provider) => provider.id)).size === providers.length,
        ),
})

export const cloudflareZoneIdSchema = z.string().regex(/^[a-f0-9]{32}$/u)
/** Canonical ASCII DNS zone names may contain underscores (unlike certificate SANs). */
export const dnsZoneNameSchema = z
    .string()
    .max(253)
    .refine(
        (value) =>
            value.includes('.') &&
            !/^\d+(?:\.\d+){3}$/u.test(value) &&
            value
                .split('.')
                .every(
                    (label) =>
                        label.length <= 63 && /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/u.test(label),
                ),
    )
export const desecZoneIdSchema = dnsZoneNameSchema.max(191)
export const hetznerZoneIdSchema = z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/u)
    .refine(
        (value) => value === value.trim() && (value.length < 19 || value <= '9223372036854775807'),
    )
export const dnsZoneIdSchema = z.union([
    cloudflareZoneIdSchema,
    desecZoneIdSchema,
    hetznerZoneIdSchema,
])

export function isDnsZoneIdForProvider(
    value: string,
    provider: z.infer<typeof dnsProviderIdSchema>,
) {
    const schemas = {
        cloudflare: cloudflareZoneIdSchema,
        desec: desecZoneIdSchema,
        hetzner: hetznerZoneIdSchema,
    }
    return schemas[provider].safeParse(value).success
}

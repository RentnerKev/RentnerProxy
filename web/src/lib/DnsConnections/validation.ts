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
export const desecZoneIdSchema = z
    .string()
    .max(191)
    .refine(
        (value) =>
            value.includes('.') &&
            !/^\d+(?:\.\d+){3}$/u.test(value) &&
            value
                .split('.')
                .every(
                    (label) =>
                        label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
                ),
    )
export const dnsZoneIdSchema = z.union([cloudflareZoneIdSchema, desecZoneIdSchema])

export function isDnsZoneIdForProvider(
    value: string,
    provider: z.infer<typeof dnsProviderIdSchema>,
) {
    return (provider === 'desec' ? desecZoneIdSchema : cloudflareZoneIdSchema).safeParse(value)
        .success
}

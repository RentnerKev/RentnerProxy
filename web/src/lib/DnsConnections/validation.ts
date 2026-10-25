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

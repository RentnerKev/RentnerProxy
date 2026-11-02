import { z } from 'zod'
import { MAX_PROXY_UPSTREAM_MEMBERS } from '@/config/upstream-pools.config.ts'
import type { ProxyHostUpstreamHealth } from './Types/upstream-health.types.ts'
/**
 * Validates the bounded controller observation shape without trusting its meaning.
 * Desired revision, exact ordered member tuples, aggregate state and observation
 * freshness are checked separately by the authorized health reader.
 */
export const proxyHostUpstreamHealthSchema = z.strictObject({
    hostId: z.uuid().transform((value) => value.toLowerCase()),
    revision: z
        .string()
        .regex(/^sha256:[a-f0-9]{64}$/u)
        .nullable(),
    observedAt: z.iso.datetime({ offset: true }).nullable(),
    state: z.enum(['available', 'all_unavailable', 'unknown']),
    members: z
        .array(
            z.strictObject({
                index: z
                    .number()
                    .int()
                    .min(0)
                    .max(MAX_PROXY_UPSTREAM_MEMBERS - 1),
                host: z.string().min(1).max(253),
                port: z.number().int().min(1).max(65_535),
                state: z.enum(['available', 'unavailable', 'unknown']),
            }),
        )
        .max(MAX_PROXY_UPSTREAM_MEMBERS),
}) satisfies z.ZodType<ProxyHostUpstreamHealth>

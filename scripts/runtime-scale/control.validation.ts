import { z } from 'zod'

export const countsSchema = z.strictObject({
    proxyHosts: z.number().int().nonnegative(),
    domains: z.number().int().nonnegative(),
    redirectHosts: z.number().int().nonnegative(),
    policies: z.number().int().nonnegative(),
    certificates: z.number().int().nonnegative(),
    trustedCas: z.number().int().nonnegative(),
    managementReads: z.number().int().nonnegative(),
    mutations: z.number().int().nonnegative(),
})

export const scaleResultSchema = z.object({
    desiredRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    counts: countsSchema,
    inventoryFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    traffic: z
        .array(
            z.object({
                domain: z
                    .string()
                    .min(1)
                    .max(253)
                    .regex(/^[a-z0-9.-]+$/u),
                status: z.union([z.literal(200), z.literal(404), z.literal(302), z.literal(307)]),
                backend: z.enum(['a', 'b', 'tls']).optional(),
                location: z.string().max(2048).optional(),
            }),
        )
        .max(1000),
    tlsHost: z
        .string()
        .max(253)
        .regex(/^[a-z0-9.-]+$/u)
        .optional(),
    certificateFingerprint: z
        .string()
        .regex(/^sha256:[a-f0-9]{64}$/u)
        .optional(),
    importRetryVerified: z.boolean().optional(),
})

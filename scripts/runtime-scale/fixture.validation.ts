import { z } from 'zod'

const hostSchema = z.strictObject({
    id: z.uuid(),
    index: z.number().int(),
    domains: z.array(z.string()),
    enabled: z.boolean(),
    forwardScheme: z.enum(['http', 'https']),
    forwardHost: z.string(),
    forwardPort: z.number().int(),
    certificateId: z.uuid().nullable(),
    forceHttps: z.boolean(),
    verifyUpstreamTls: z.boolean(),
    upstreamTlsServerName: z.string().nullable(),
    trustedCaId: z.uuid().nullable(),
    accessPolicyId: z.uuid().nullable(),
    backend: z.enum(['primary', 'secondary', 'trusted']),
    deleted: z.boolean(),
})

const redirectSchema = z.strictObject({
    id: z.uuid(),
    index: z.number().int(),
    domains: z.array(z.string()),
    enabled: z.boolean(),
    destination: z.string(),
    statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]),
    preserveRequestUri: z.boolean(),
    certificateId: z.uuid().nullable(),
    deleted: z.boolean(),
})

export const inventorySchema = z.strictObject({
    runId: z.string(),
    domain: z.string(),
    certificateId: z.uuid(),
    trustedCaId: z.uuid(),
    hosts: z.array(hostSchema),
    redirects: z.array(redirectSchema),
    policies: z.array(z.strictObject({ id: z.uuid(), name: z.string(), description: z.string() })),
    npmRuns: z.array(z.uuid()),
})

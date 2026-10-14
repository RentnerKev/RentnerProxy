import { z } from 'zod'

const jobSchema = z.looseObject({
    id: z.string(),
    stage: z.string(),
    certificateId: z.string().nullable(),
    proxyHostId: z.string().nullable(),
    errorCode: z.string().nullable(),
    retryAvailable: z.boolean(),
})
const importSummarySchema = z.looseObject({
    historyFound: z.boolean(),
    imported: z.number(),
    failed: z.number(),
    skipped: z.number(),
})
export const fixtureResultSchema = z.looseObject({
    ok: z.literal(true),
    desiredRevision: z.string(),
    expected: z
        .looseObject({
            enabled: z.boolean().optional(),
            forwardPort: z.number().optional(),
            policyMode: z.string().optional(),
            redirectDestination: z.string().optional(),
            redirectEnabled: z.boolean().optional(),
            forceHttps: z.boolean().optional(),
            certificateId: z.string().nullable(),
            redirectStatus: z.number().optional(),
        })
        .optional(),
    durableCounts: z
        .looseObject({ proxyHosts: z.number(), redirects: z.number(), policies: z.number() })
        .optional(),
    certificateId: z.string().nullable().optional(),
    jobId: z.string().optional(),
    currentJob: jobSchema.nullable().optional(),
    jobs: z.array(jobSchema).optional(),
    persistedJobCounts: z.looseObject({ total: z.number(), nonApplied: z.number() }).optional(),
    identicalSourceRetry: importSummarySchema.optional(),
    importHistory: z.array(z.looseObject({ found: z.boolean() })).optional(),
})
export const controllerBodySchema = z.looseObject({
    events: z
        .array(z.looseObject({ id: z.string(), operationId: z.string(), kind: z.string() }))
        .optional(),
    hasMore: z.boolean().optional(),
    nextCursor: z.string().nullable().optional(),
})
export const backendBodySchema = z.looseObject({
    backend: z.string().optional(),
    user: z.string().optional(),
})
export const certificateIndexSchema = z.looseObject({
    certificates: z.record(
        z.string(),
        z.looseObject({
            operation: z.string(),
            nextAttemptAt: z.string().nullable().optional(),
            retryAfter: z.unknown().optional(),
        }),
    ),
})
export const dockerEventSchema = z.looseObject({
    Actor: z
        .looseObject({ Attributes: z.looseObject({ name: z.string().optional() }).optional() })
        .optional(),
})
export const responseObjectSchema = z.record(z.string(), z.unknown())

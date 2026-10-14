import { z } from 'zod'

export const certificateOperationSchema = z.looseObject({
    id: z.string(),
    kind: z.string(),
    stage: z.string(),
})
export const certificateCandidateSchema = z.looseObject({ fingerprint: z.string() })
export const certificateEventsSchema = z.array(
    z.looseObject({
        id: z.string(),
        operationId: z.string(),
        certificateId: z.string(),
        kind: z.string(),
    }),
)

export const certificateRetryIndexSchema = z.looseObject({
    certificates: z.record(
        z.string(),
        z.looseObject({
            nextAttemptAt: z.string().nullable().optional(),
            retryAfter: z.unknown().optional(),
        }),
    ),
})

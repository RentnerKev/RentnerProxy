import { z } from 'zod'

export const metadataSchema = z.object({
    status: z.string(),
    operation: z.string(),
    fingerprint: z
        .string()
        .regex(/^sha256:[a-f0-9]{64}$/u)
        .nullable(),
    lastErrorCode: z.string().nullable(),
    currentOperation: z.object({ id: z.string().uuid(), stage: z.string() }).nullable(),
    candidate: z.object({ fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).nullable(),
})

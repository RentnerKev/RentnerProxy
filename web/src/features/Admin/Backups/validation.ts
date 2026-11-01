import { z } from 'zod'

export const backupScheduleFormSchema = z.strictObject({
    enabled: z.boolean(),
    intervalHours: z
        .string()
        .regex(/^\d+$/u)
        .transform(Number)
        .pipe(z.number().int().min(1).max(8760)),
    retentionCount: z
        .string()
        .regex(/^\d+$/u)
        .transform(Number)
        .pipe(z.number().int().min(1).max(50)),
})

export const backupSearchSchema = z.object({
    downloadError: z
        .enum([
            'not_found',
            'conflict',
            'unavailable',
            'permission_denied',
            'authentication_required',
            'rate_limited',
        ])
        .optional()
        .catch(undefined),
})

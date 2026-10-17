import { z } from 'zod'
import { ddnsDraftSchema, ddnsRevisionSchema } from '@/lib/Ddns/validation.ts'

export const previewDdnsSchema = z.strictObject({
    expectedRevision: ddnsRevisionSchema,
    draft: ddnsDraftSchema,
    intent: z.enum(['save', 'enable']),
})
export const saveDdnsSchema = z.strictObject({
    expectedRevision: ddnsRevisionSchema,
    draft: ddnsDraftSchema,
    receipt: z.string().min(1).max(2048),
    confirmedPause: z.boolean(),
})
export const enableDdnsSchema = z.strictObject({
    expectedRevision: ddnsRevisionSchema.min(1),
    receipt: z.string().min(1).max(2048),
    confirmed: z.literal(true),
})
export const ddnsActionSchema = z.strictObject({ expectedRevision: ddnsRevisionSchema.min(1) })
export const applyDdnsSchema = z.strictObject({
    expectedRevision: ddnsRevisionSchema,
    draft: ddnsDraftSchema,
    enabled: z.boolean(),
})

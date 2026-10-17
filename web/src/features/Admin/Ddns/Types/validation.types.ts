import type { z } from 'zod'
import type {
    previewDdnsSchema,
    saveDdnsSchema,
    enableDdnsSchema,
    ddnsActionSchema,
} from '../validation.ts'
import type { applyDdnsSchema } from '../validation.ts'
export type ApplyDdnsInput = z.infer<typeof applyDdnsSchema>
export type PreviewDdnsInput = z.infer<typeof previewDdnsSchema>
export type SaveDdnsInput = z.infer<typeof saveDdnsSchema>
export type EnableDdnsInput = z.infer<typeof enableDdnsSchema>
export type DdnsActionInput = z.infer<typeof ddnsActionSchema>

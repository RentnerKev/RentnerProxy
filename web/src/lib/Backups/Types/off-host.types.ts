import type { z } from 'zod'
import type {
    offHostConfigurationUpdateSchema,
    offHostStatusSchema,
    offHostReceiptSchema,
    offHostJobSchema,
} from '../offHostValidation.ts'

export type OffHostConfigurationUpdate = z.infer<typeof offHostConfigurationUpdateSchema>
export type OffHostStatus = z.infer<typeof offHostStatusSchema>
export type OffHostReceipt = z.infer<typeof offHostReceiptSchema>
export type OffHostJob = z.infer<typeof offHostJobSchema>
export type OffHostConfigurationInput = Omit<OffHostConfigurationUpdate, 'actorId'>

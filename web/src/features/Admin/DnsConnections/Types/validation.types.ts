import type { z } from 'zod'
import type {
    deleteDnsConnectionSchema,
    saveDnsConnectionSchema,
    testDnsConnectionSchema,
} from '../validation.ts'

export type SaveDnsConnectionInput = z.infer<typeof saveDnsConnectionSchema>
export type TestDnsConnectionInput = z.infer<typeof testDnsConnectionSchema>
export type DeleteDnsConnectionInput = z.infer<typeof deleteDnsConnectionSchema>

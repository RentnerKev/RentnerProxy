import type { z } from 'zod'
import type {
    ddnsDraftSchema,
    ddnsTargetSchema,
    ddnsSnapshotSchema,
    ddnsBatchSchema,
} from '../validation.ts'

export type DdnsDraft = z.infer<typeof ddnsDraftSchema>
export type DdnsTarget = z.infer<typeof ddnsTargetSchema>
export type DdnsSnapshot = z.infer<typeof ddnsSnapshotSchema>
export type DdnsBatch = z.infer<typeof ddnsBatchSchema>
export interface DdnsPreview {
    readonly batch: DdnsBatch
    readonly receipt: string | null
    readonly expiresAt: number | null
}

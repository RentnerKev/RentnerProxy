import type { z } from 'zod'
import type {
    bulkHostActionSchema,
    bulkHostApplySchema,
    bulkHostPreviewSchema,
} from '@/features/Admin/HostBulkActions/validation.ts'

export type BulkHostAction = z.infer<typeof bulkHostActionSchema>
export type BulkHostPreviewInput = z.infer<typeof bulkHostPreviewSchema>
export type BulkHostApplyInput = z.infer<typeof bulkHostApplySchema>
export type BulkHostReason =
    | 'permission'
    | 'missing'
    | 'discovery'
    | 'unsupported'
    | 'conflict'
    | 'invalid'
    | 'unavailable'
    | 'timeout'
export interface BulkHostOutcome {
    readonly id: string
    readonly label: string | null
    readonly status: 'ready' | 'applied' | 'unchanged' | 'skipped' | 'failed'
    readonly reason?: BulkHostReason
    readonly version?: string
}
export interface BulkHostResult {
    readonly rows: readonly BulkHostOutcome[]
    readonly runtimeStatus: 'unchanged' | 'applied' | 'pending'
}

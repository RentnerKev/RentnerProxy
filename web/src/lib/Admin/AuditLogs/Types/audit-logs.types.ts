import type { AuditMetadata } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'

export interface AuditMetadataEntry {
    readonly key: keyof AuditMetadata
    readonly value: string
}

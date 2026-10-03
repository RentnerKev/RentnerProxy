import type { recordAuditEventBestEffortService } from '@/server/Audit/audit.service.ts'

export type FailureEvent = Omit<Parameters<typeof recordAuditEventBestEffortService>[0], 'result'>

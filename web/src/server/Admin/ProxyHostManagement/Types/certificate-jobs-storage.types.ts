import type { certificateJobs } from '@/db/schema.ts'

export type CertificateJobRow = typeof certificateJobs.$inferSelect

export type CertificateJobManualDnsState = 'not_manual' | 'pending' | 'failed' | 'complete'

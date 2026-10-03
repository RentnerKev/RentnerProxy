import type { certificateJobs } from '@/db/schema.ts'

export type CertificateJobRow = typeof certificateJobs.$inferSelect

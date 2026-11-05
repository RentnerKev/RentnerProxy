export const BACKUP_AUDIT_POLICY = {
    // Leave completion room when upgrading an unacknowledged legacy 500-event journal.
    capacity: 600,
    jobEvents: 53,
} as const

export const BACKUP_UI_POLICY = {
    pollIntervalMs: 5_000,
    requestTimeoutMs: 20_000,
    responseLimitBytes: 512 * 1_024,
} as const

export const BACKUPS_LOCAL_DEMO_KEY = 'backups_local_demo_v1'

export const RESTORE_COMPLETION_VISIBLE_MS = 600

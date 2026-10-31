export const BACKUP_AUDIT_POLICY = {
    // Leave completion room when upgrading an unacknowledged legacy 500-event journal.
    capacity: 600,
    jobEvents: 53,
} as const

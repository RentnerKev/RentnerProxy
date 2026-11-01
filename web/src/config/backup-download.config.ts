export const BACKUP_DOWNLOAD_TIMEOUTS = {
    connectionMs: 5_000,
    idleMs: 5 * 60 * 1_000,
    // Four hours allows about 96 GiB of maximum-format preparation I/O at roughly 7 MiB/s.
    preparationMs: 4 * 60 * 60 * 1_000,
}

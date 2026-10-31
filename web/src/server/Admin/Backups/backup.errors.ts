export const BACKUP_ERRORS = [
    'invalid_input',
    'busy',
    'revision_conflict',
    'capacity',
    'unavailable',
] as const
export class BackupDomainError extends Error {
    constructor(readonly code: (typeof BACKUP_ERRORS)[number]) {
        super(code)
    }
}

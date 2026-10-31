import type { createBackupAdminService } from '../backups.service.ts'

export interface BackupsHttpDependencies {
    readonly service: ReturnType<typeof createBackupAdminService>
    readonly origin: () => string | null
}

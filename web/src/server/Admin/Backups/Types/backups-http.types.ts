import type { createBackupAdminService } from '../backups.service.ts'

export interface BackupsHttpDependencies {
    readonly service: Pick<
        ReturnType<typeof createBackupAdminService>,
        'getBackupsStatusService' | 'requestBackupService' | 'updateBackupConfigurationService'
    > &
        Partial<
            Pick<
                ReturnType<typeof createBackupAdminService>,
                'deleteBackupService' | 'restoreBackupService'
            >
        >
    readonly origin: () => string | null
}

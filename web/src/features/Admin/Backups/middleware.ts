import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import {
    managedBackupStartSchema,
    managedBackupConfigurationUpdateSchema,
} from '@/lib/Backups/validation.ts'
import {
    getBackupsStatusService,
    requestBackupService,
    updateBackupConfigurationService,
} from '@/server/Admin/Backups/backups.service.ts'
import { BackupDomainError } from '@/server/Admin/Backups/backup.errors.ts'
import { localizedActionFailure, throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'

function noStore() {
    setResponseHeader('Cache-Control', 'private, no-store')
}
function failure(error: unknown) {
    if (!(error instanceof BackupDomainError))
        return localizedActionFailure(error, 'admin.backups.errors.unavailable')
    setResponseStatus(
        error.code === 'invalid_input' ? 400 : error.code === 'unavailable' ? 503 : 409,
    )
    return { success: false as const, message: `admin.backups.errors.${error.code}` }
}
export const getBackupsStatusHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return await getBackupsStatusService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.backups.errors.unavailable')
    }
})
export const requestBackupHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => managedBackupStartSchema.omit({ actorId: true }).parse(input))
    .handler(async ({ data }) => {
        noStore()
        try {
            return { success: true as const, value: await requestBackupService(data) }
        } catch (error) {
            return failure(error)
        }
    })
export const updateBackupConfigurationHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) =>
        managedBackupConfigurationUpdateSchema.omit({ actorId: true }).parse(input),
    )
    .handler(async ({ data }) => {
        noStore()
        try {
            return { success: true as const, value: await updateBackupConfigurationService(data) }
        } catch (error) {
            return failure(error)
        }
    })

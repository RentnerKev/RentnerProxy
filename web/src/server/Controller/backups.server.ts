import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { managedBackupStatusSchema } from '@/lib/Backups/validation.ts'
import type {
    ManagedBackupStart,
    ManagedBackupConfigurationUpdate,
} from '@/lib/Backups/Types/backups.types.ts'
import { BACKUP_ERRORS, BackupDomainError } from '@/server/Admin/Backups/backup.errors.ts'
import { controllerRequest } from './transport.server.ts'

const failureSchema = z.strictObject({ error: z.enum([...BACKUP_ERRORS, 'conflict']) })
function decode(payload: unknown) {
    const failure = failureSchema.safeParse(payload)
    if (failure.success)
        throw new BackupDomainError(
            failure.data.error === 'conflict' ? 'revision_conflict' : failure.data.error,
        )
    const parsed = managedBackupStatusSchema.safeParse(payload)
    if (!parsed.success) throw new BackupDomainError('unavailable')
    return parsed.data
}
export function createBackupsController(request = controllerRequest) {
    const options = {
        timeoutMs: 15_000,
        responseLimit: 512 * 1_024,
        privileged: true,
        acceptErrorResponse: true,
    }
    return {
        async status(signal?: AbortSignal) {
            return decode(
                await request('/internal/v1/backups/status', {
                    ...options,
                    timeoutMs: 5_000,
                    ...(signal ? { signal } : {}),
                }),
            )
        },
        async start(input: ManagedBackupStart) {
            return decode(
                await request('/internal/v1/backups/start', {
                    ...options,
                    method: 'POST',
                    body: JSON.stringify(input),
                }),
            )
        },
        async configure(input: ManagedBackupConfigurationUpdate) {
            return decode(
                await request('/internal/v1/backups/config', {
                    ...options,
                    method: 'PUT',
                    body: JSON.stringify(input),
                }),
            )
        },
    }
}
export const backupsController = createBackupsController()

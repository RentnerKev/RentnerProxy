import '@tanstack/react-start/server-only'
import { z } from 'zod'
import {
    managedBackupAuditAcknowledgementSchema,
    managedBackupStatusSchema,
    managedBackupMaintenanceSchema,
} from '@/lib/Backups/validation.ts'
import type {
    ManagedBackupStart,
    ManagedBackupAuditAcknowledgement,
    ManagedBackupConfigurationUpdate,
    ManagedBackupDelete,
    ManagedBackupRestore,
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
        async maintenance() {
            const value = await request('/internal/v1/backups/maintenance', {
                ...options,
                timeoutMs: 5_000,
            })
            const parsed = z
                .strictObject({ maintenance: managedBackupMaintenanceSchema.nullable() })
                .safeParse(value)
            if (!parsed.success) throw new BackupDomainError('unavailable')
            return parsed.data.maintenance
        },
        async delete(id: string, input: ManagedBackupDelete) {
            if (!z.uuid().safeParse(id).success) throw new BackupDomainError('invalid_input')
            return decode(
                await request(`/internal/v1/backups/${id}/delete`, {
                    ...options,
                    method: 'POST',
                    body: JSON.stringify(input),
                }),
            )
        },
        async restore(id: string, input: ManagedBackupRestore) {
            if (!z.uuid().safeParse(id).success) throw new BackupDomainError('invalid_input')
            return decode(
                await request(`/internal/v1/backups/${id}/restore`, {
                    ...options,
                    method: 'POST',
                    body: JSON.stringify(input),
                }),
            )
        },
        async status(signal?: AbortSignal) {
            return decode(
                await request('/internal/v1/backups/status', {
                    ...options,
                    timeoutMs: 5_000,
                    ...(signal ? { signal } : {}),
                }),
            )
        },
        async acknowledgeAudit(input: ManagedBackupAuditAcknowledgement, signal?: AbortSignal) {
            return decode(
                await request('/internal/v1/backups/audit/ack', {
                    ...options,
                    timeoutMs: 5_000,
                    method: 'POST',
                    body: JSON.stringify(managedBackupAuditAcknowledgementSchema.parse(input)),
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

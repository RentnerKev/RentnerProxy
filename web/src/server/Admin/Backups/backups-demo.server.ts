import '@tanstack/react-start/server-only'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { BACKUPS_LOCAL_DEMO_KEY } from '@/config/backups.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { systemSettings } from '@/db/schema.ts'
import { createDemoOffHostStatus, isLocalBackupDemoEnvironment } from '@/lib/Backups/demoStatus.ts'
import type { ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'
import { managedBackupDeleteSchema, managedBackupStatusSchema } from '@/lib/Backups/validation.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { BackupDomainError } from './backup.errors.ts'

const deleteDemoInputSchema = managedBackupDeleteSchema.extend({ jobId: z.uuid() })
export type DeleteLocalBackupDemoInput = z.infer<typeof deleteDemoInputSchema>

export function applyLocalBackupDemoDelete(
    status: ManagedBackupStatus,
    input: DeleteLocalBackupDemoInput,
    now = Date.now(),
): ManagedBackupStatus {
    const parsed = deleteDemoInputSchema.safeParse(input)
    if (!parsed.success) throw new BackupDomainError('invalid_input')
    const receipt = status.maintenance
    if (receipt?.requestId === input.requestId) {
        if (
            receipt.operation !== 'delete' ||
            receipt.actorId !== input.actorId ||
            receipt.artifactId !== input.jobId ||
            receipt.metadataSha256 !== input.metadataSha256 ||
            receipt.state !== 'succeeded'
        )
            throw new BackupDomainError('revision_conflict')
        return status
    }
    if (
        status.jobs.some((job) => job.state === 'queued' || job.state === 'running') ||
        receipt?.state === 'queued' ||
        receipt?.state === 'running'
    )
        throw new BackupDomainError('busy')
    const job = status.jobs.find((entry) => entry.id === input.jobId)
    if (!job) throw new BackupDomainError('revision_conflict')
    if (
        (job.artifact && job.artifact.id !== job.id) ||
        (job.artifact?.metadataSha256 ?? null) !== input.metadataSha256
    )
        throw new BackupDomainError('revision_conflict')
    // This database fixture must never become a filesystem operation or impersonate a real archive.
    if (job.retained) throw new BackupDomainError('unavailable')
    return managedBackupStatusSchema.parse({
        ...status,
        jobs: status.jobs.filter((entry) => entry.id !== input.jobId),
        maintenance: {
            id: input.requestId,
            requestId: input.requestId,
            actorId: input.actorId,
            actorName: null,
            artifactId: input.jobId,
            metadataSha256: input.metadataSha256,
            operation: 'delete',
            state: 'succeeded',
            phase: 'complete',
            progressPercent: 100,
            requestedAt: now,
            startedAt: now,
            finishedAt: now,
            error: null,
        },
    })
}

export async function deleteLocalBackupDemoService(
    input: DeleteLocalBackupDemoInput,
): Promise<ManagedBackupStatus> {
    if (!isLocalBackupDemoEnvironment(process.env)) throw new BackupDomainError('unavailable')
    const parsed = deleteDemoInputSchema.safeParse(input)
    if (!parsed.success) throw new BackupDomainError('invalid_input')
    return getAuthDatabase().transaction(async (transaction) => {
        if (!isLocalBackupDemoEnvironment(process.env)) throw new BackupDomainError('unavailable')
        await requirePermissionInTransaction(
            transaction,
            parsed.data.actorId,
            PERMISSIONS.BACKUPS_MANAGE,
        )
        const [row] = await transaction
            .select({ value: systemSettings.value })
            .from(systemSettings)
            .where(eq(systemSettings.key, BACKUPS_LOCAL_DEMO_KEY))
            .limit(1)
            .for('update')
        let value: unknown = row?.value
        if (typeof value === 'string') {
            try {
                value = JSON.parse(value)
            } catch {
                throw new BackupDomainError('unavailable')
            }
        }
        const current = managedBackupStatusSchema.safeParse(value)
        if (!current.success) throw new BackupDomainError('unavailable')
        const saved = applyLocalBackupDemoDelete(current.data, parsed.data)
        if (saved === current.data) return saved
        await transaction
            .update(systemSettings)
            .set({ value: saved, updatedAt: new Date() })
            .where(eq(systemSettings.key, BACKUPS_LOCAL_DEMO_KEY))
        await appendAuditEventInTransactionService(transaction, {
            actorUserId: parsed.data.actorId,
            actorKind: 'user',
            action: 'delete',
            resource: 'security-settings',
            targetId: parsed.data.jobId,
            result: 'success',
            metadata: { operationId: parsed.data.requestId },
        })
        return saved
    })
}

export async function getLocalBackupDemoStatus(): Promise<ManagedBackupStatus | null> {
    if (!isLocalBackupDemoEnvironment(process.env)) return null
    const [row] = await getAuthDatabase()
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, BACKUPS_LOCAL_DEMO_KEY))
        .limit(1)
    if (!row) return null
    let value: unknown = row.value
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value)
        } catch {
            return null
        }
    }
    const parsed = managedBackupStatusSchema.safeParse(value)
    return parsed.success
        ? { ...parsed.data, offHost: parsed.data.offHost ?? createDemoOffHostStatus() }
        : null
}

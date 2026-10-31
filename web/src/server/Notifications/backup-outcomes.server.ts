import '@tanstack/react-start/server-only'
import { randomUUID } from 'node:crypto'
import type { ManagedBackupAuditEvent } from '@/lib/Backups/Types/backups.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { resolveEffectiveNotificationConfigurationInTransaction } from './notification-access.ts'
import {
    lockNotificationConfiguration,
    lockNotificationRuntime,
    writeNotificationRuntime,
} from './notification-storage.ts'
import { enqueueBackupOutcomeNotifications } from './backup-outcomes.ts'

export async function enqueueBackupOutcomesInTransaction(
    transaction: AuthTransaction,
    events: readonly ManagedBackupAuditEvent[],
) {
    if (
        !events.some(
            (event) =>
                event.kind === 'succeeded' ||
                event.kind === 'failed' ||
                event.kind === 'interrupted',
        )
    )
        return { accepted: events.length, changed: false }
    // Match configuration updates and delivery claims: configuration before runtime, then caller's audit lock.
    const configuration = await resolveEffectiveNotificationConfigurationInTransaction(
        transaction,
        await lockNotificationConfiguration(transaction),
    )
    if (
        !configuration.enabled ||
        configuration.pausedAfterRestore ||
        !configuration.channels.some(
            (channel) => channel.enabled && channel.events.includes('backup'),
        )
    )
        return { accepted: events.length, changed: false }
    const runtime = await lockNotificationRuntime(transaction)
    const result = enqueueBackupOutcomeNotifications(
        runtime.engine,
        configuration,
        events,
        Date.now(),
        randomUUID,
    )
    if (result.queued > 0)
        await writeNotificationRuntime(transaction, { ...runtime, engine: result.state })
    return { accepted: result.accepted, changed: result.queued > 0 }
}

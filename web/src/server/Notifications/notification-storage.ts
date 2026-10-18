// oxlint-disable-next-line import/no-unassigned-import -- Notification configuration and queue persistence are server-only.
import '@tanstack/react-start/server-only'

import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { NOTIFICATION_SETTINGS_KEY, NOTIFICATION_STATE_KEY } from '@/config/notifications.config.ts'
import { systemSettings } from '@/db/schema.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { certificateEventCursorSchema } from '@/server/Controller/certificates.validation.ts'
import { createNotificationState } from './incident-engine.ts'
import { NotificationDomainError } from './notification.errors.ts'
import { DEFAULT_NOTIFICATION_CONFIGURATION } from './notification-settings.ts'
import { storedNotificationConfigurationSchema } from './notification-settings.validation.ts'
import { notificationStateSchema } from './notification-state.validation.ts'
import type {
    NotificationRuntime,
    StoredNotificationConfiguration,
} from './Types/notification-internal.types.ts'

const runtimeSchema: z.ZodType<NotificationRuntime> = z.strictObject({
    version: z.literal(1),
    engine: notificationStateSchema,
    certificateCursor: certificateEventCursorSchema.nullable(),
    collectionLease: z
        .strictObject({
            token: z.uuid(),
            expiresAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        })
        .nullable(),
})

function createRuntime(): NotificationRuntime {
    return {
        version: 1,
        engine: createNotificationState(),
        certificateCursor: null,
        collectionLease: null,
    }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    try {
        return schema.parse(typeof value === 'string' ? JSON.parse(value) : value)
    } catch {
        throw new NotificationDomainError('configuration_unavailable')
    }
}

async function readSetting<T>(
    transaction: AuthTransaction,
    key: string,
    initial: T,
    schema: z.ZodType<T>,
    lock: boolean,
): Promise<T> {
    if (lock)
        await transaction
            .insert(systemSettings)
            .values({ key, value: sql`${initial}` })
            .onConflictDoNothing({ target: systemSettings.key })
    const query = transaction
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, key))
        .limit(1)
    const [row] = lock ? await query.for('update') : await query
    return row ? parse(schema, row.value) : structuredClone(initial)
}

async function writeSetting<T>(
    transaction: AuthTransaction,
    key: string,
    value: T,
    schema: z.ZodType<T>,
): Promise<void> {
    const validated = parse(schema, value)
    await transaction
        .update(systemSettings)
        .set({ value: sql`${validated}`, updatedAt: new Date() })
        .where(eq(systemSettings.key, key))
}

export function readNotificationConfiguration(
    transaction: AuthTransaction,
): Promise<StoredNotificationConfiguration> {
    return readSetting(
        transaction,
        NOTIFICATION_SETTINGS_KEY,
        DEFAULT_NOTIFICATION_CONFIGURATION,
        storedNotificationConfigurationSchema,
        false,
    )
}
export function lockNotificationConfiguration(
    transaction: AuthTransaction,
): Promise<StoredNotificationConfiguration> {
    return readSetting(
        transaction,
        NOTIFICATION_SETTINGS_KEY,
        DEFAULT_NOTIFICATION_CONFIGURATION,
        storedNotificationConfigurationSchema,
        true,
    )
}
export function writeNotificationConfiguration(
    transaction: AuthTransaction,
    value: StoredNotificationConfiguration,
): Promise<void> {
    return writeSetting(
        transaction,
        NOTIFICATION_SETTINGS_KEY,
        value,
        storedNotificationConfigurationSchema,
    )
}
export function readNotificationRuntime(
    transaction: AuthTransaction,
): Promise<NotificationRuntime> {
    return readSetting(transaction, NOTIFICATION_STATE_KEY, createRuntime(), runtimeSchema, false)
}
export function lockNotificationRuntime(
    transaction: AuthTransaction,
): Promise<NotificationRuntime> {
    return readSetting(transaction, NOTIFICATION_STATE_KEY, createRuntime(), runtimeSchema, true)
}
export function writeNotificationRuntime(
    transaction: AuthTransaction,
    value: NotificationRuntime,
): Promise<void> {
    return writeSetting(transaction, NOTIFICATION_STATE_KEY, value, runtimeSchema)
}

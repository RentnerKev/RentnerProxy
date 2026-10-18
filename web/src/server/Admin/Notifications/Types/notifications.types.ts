import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import type { buildNotificationConfiguration } from '@/server/Notifications/notification-settings.ts'
import type {
    readNotificationConfiguration,
    lockNotificationConfiguration,
    writeNotificationConfiguration,
    readNotificationRuntime,
    lockNotificationRuntime,
    writeNotificationRuntime,
} from '@/server/Notifications/notification-storage.ts'

export interface NotificationAdminDependencies {
    readonly authorize: (permission: PermissionKey) => Promise<{ readonly id: string }>
    readonly authorizeInTransaction: (
        transaction: AuthTransaction,
        actorId: string,
        permission: PermissionKey,
    ) => Promise<unknown>
    readonly transaction: <T>(
        run: (transaction: AuthTransaction) => Promise<T>,
        readOnly: boolean,
    ) => Promise<T>
    readonly limit: (actorId: string) => Promise<void>
    readonly readConfiguration: typeof readNotificationConfiguration
    readonly lockConfiguration: typeof lockNotificationConfiguration
    readonly writeConfiguration: typeof writeNotificationConfiguration
    readonly readRuntime: typeof readNotificationRuntime
    readonly lockRuntime: typeof lockNotificationRuntime
    readonly writeRuntime: typeof writeNotificationRuntime
    readonly buildConfiguration: typeof buildNotificationConfiguration
    readonly audit: typeof appendAuditEventInTransactionService
    readonly publish: () => void
    readonly now: () => number
    readonly makeId: () => string
}

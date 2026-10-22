import type { NotificationAdminDependencies } from '@/server/Admin/Notifications/Types/notifications.types.ts'
import type { StoredNotificationConfiguration } from './notification-internal.types.ts'
import type { NotificationEngineConfiguration } from './notification-state.types.ts'

export type NotificationConfigurationPersistenceDependencies = Pick<
    NotificationAdminDependencies,
    'lockRuntime' | 'writeConfiguration' | 'writeRuntime' | 'audit' | 'now' | 'makeId'
>

export interface NotificationConfigurationPersistenceInput {
    readonly actorId: string
    readonly configuration: StoredNotificationConfiguration
    readonly effective: NotificationEngineConfiguration
    readonly newIds: ReadonlySet<string>
    readonly channelCount: number
}

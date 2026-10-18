import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type { NotificationAdminDependencies } from '@/server/Admin/Notifications/Types/notifications.types.ts'
import type { openNotificationDestination } from '@/server/Notifications/notification-settings.ts'
import type { resolveEffectiveNotificationConfigurationInTransaction } from '@/server/Notifications/notification-access.ts'
import type { deliverAuthorizedNotificationClaim } from '@/server/Notifications/notification-delivery.server.ts'
import type { acknowledgeNotificationDelivery } from '@/server/Notifications/notification-repository.ts'
import type { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'

export interface PersonalNotificationDependencies extends Omit<
    NotificationAdminDependencies,
    'authorize' | 'authorizeInTransaction'
> {
    readonly authorize: (
        permission: Parameters<NotificationAdminDependencies['authorize']>[0],
    ) => Promise<AuthenticatedUser>
    readonly authorizeInTransaction: typeof requirePermissionInTransaction
    readonly openDestination: typeof openNotificationDestination
    readonly effectiveConfiguration: typeof resolveEffectiveNotificationConfigurationInTransaction
    readonly smtpConfigured: () => boolean
    readonly limitTest: (actorId: string) => Promise<void>
    readonly deliver: typeof deliverAuthorizedNotificationClaim
    readonly acknowledge: typeof acknowledgeNotificationDelivery
}

import '@tanstack/react-start/server-only'

import type { NotificationDeliveryResult } from '@/lib/Notifications/Types/notifications.types.ts'
import { deliverNotification } from './delivery.service.ts'
import { authorizeNotificationDelivery } from './notification-repository.ts'
import { openNotificationDestination } from './notification-settings.ts'
import { NotificationDomainError } from './notification.errors.ts'
import type { NotificationDeliveryClaim } from './Types/notification-internal.types.ts'

export function createAuthorizedNotificationDelivery(dependencies: {
    readonly authorize: typeof authorizeNotificationDelivery
    readonly open: typeof openNotificationDestination
    readonly deliver: typeof deliverNotification
}) {
    return async (
        claim: NotificationDeliveryClaim,
        signal?: AbortSignal,
    ): Promise<NotificationDeliveryResult> => {
        try {
            const authorized = await dependencies.authorize(claim)
            if (!authorized) return { success: false, code: 'cancelled', retryable: false }
            const destination = await dependencies.open(authorized.channel)
            if (
                destination.kind === 'webhook' &&
                destination.allowedPrivateCidrs.length > 0 &&
                !authorized.allowPrivateDestinations
            )
                return { success: false, code: 'destination_blocked', retryable: false }
            if (signal?.aborted) return { success: false, code: 'cancelled', retryable: true }
            return destination.kind === 'email'
                ? await dependencies.deliver(
                      destination,
                      claim.payload,
                      signal,
                      authorized.mailAppearance,
                  )
                : await dependencies.deliver(destination, claim.payload, signal)
        } catch (error) {
            return error instanceof NotificationDomainError
                ? { success: false, code: 'configuration_unavailable', retryable: false }
                : { success: false, code: 'destination_unavailable', retryable: true }
        }
    }
}

export const deliverAuthorizedNotificationClaim = createAuthorizedNotificationDelivery({
    authorize: authorizeNotificationDelivery,
    open: openNotificationDestination,
    deliver: deliverNotification,
})

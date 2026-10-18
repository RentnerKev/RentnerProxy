import { createServerFn } from '@tanstack/react-start'
import {
    validateNotificationInput,
    noStore,
    notificationFailure,
    notificationQueryFailure,
} from '@/server/Notifications/transport.server.ts'
import { localizedActionFailure } from '@/server/Auth/transport.server.ts'
import { NotificationDomainError } from '@/server/Notifications/notification.errors.ts'
import { updateNotificationConfigurationSchema } from '@/lib/Notifications/validation.ts'
import {
    getNotificationConfigurationService,
    getNotificationStatusService,
    updateNotificationConfigurationService,
} from '@/server/Admin/Notifications/notifications.service.ts'

export const getNotificationConfigurationHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        noStore()
        try {
            return await getNotificationConfigurationService()
        } catch (error) {
            return notificationQueryFailure(error)
        }
    },
)

export const getNotificationStatusHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return await getNotificationStatusService()
    } catch (error) {
        return notificationQueryFailure(error)
    }
})

export const updateNotificationConfigurationHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => {
        return validateNotificationInput(updateNotificationConfigurationSchema, input)
    })
    .handler(async ({ data }) => {
        noStore()
        try {
            return {
                success: true as const,
                value: await updateNotificationConfigurationService(data),
            }
        } catch (error) {
            return error instanceof NotificationDomainError
                ? notificationFailure(error)
                : localizedActionFailure(error, 'common.requestFailed')
        }
    })

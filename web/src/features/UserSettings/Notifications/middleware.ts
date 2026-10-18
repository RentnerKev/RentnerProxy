import { createServerFn } from '@tanstack/react-start'
import {
    validateNotificationInput,
    noStore,
    notificationFailure,
    notificationQueryFailure,
} from '@/server/Notifications/transport.server.ts'
import { localizedActionFailure } from '@/server/Auth/transport.server.ts'
import { NotificationDomainError } from '@/server/Notifications/notification.errors.ts'
import {
    updatePersonalNotificationConfigurationSchema,
    testPersonalNotificationChannelSchema,
} from '@/lib/Notifications/validation.ts'
import {
    getPersonalNotificationSettingsService,
    getPersonalNotificationStatusService,
    updatePersonalNotificationConfigurationService,
    testPersonalNotificationChannelService,
} from '@/server/UserSettings/Notifications/notifications.service.ts'

export const getPersonalNotificationSettingsHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        noStore()
        try {
            return await getPersonalNotificationSettingsService()
        } catch (error) {
            return notificationQueryFailure(error)
        }
    },
)

export const getPersonalNotificationStatusHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        noStore()
        try {
            return await getPersonalNotificationStatusService()
        } catch (error) {
            return notificationQueryFailure(error)
        }
    },
)

export const updatePersonalNotificationConfigurationHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => {
        return validateNotificationInput(updatePersonalNotificationConfigurationSchema, input)
    })
    .handler(async ({ data }) => {
        noStore()
        try {
            return {
                success: true as const,
                value: await updatePersonalNotificationConfigurationService(data),
            }
        } catch (error) {
            return error instanceof NotificationDomainError
                ? notificationFailure(error)
                : localizedActionFailure(error, 'common.requestFailed')
        }
    })

export const testPersonalNotificationChannelHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => {
        return validateNotificationInput(testPersonalNotificationChannelSchema, input)
    })
    .handler(async ({ data }) => {
        noStore()
        try {
            return {
                success: true as const,
                value: await testPersonalNotificationChannelService(data),
            }
        } catch (error) {
            return error instanceof NotificationDomainError
                ? notificationFailure(error)
                : localizedActionFailure(error, 'common.requestFailed')
        }
    })

import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import { localizedActionFailure, throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'
import { NotificationDomainError } from '@/server/Notifications/notification.errors.ts'
import { updateNotificationConfigurationSchema } from '@/lib/Notifications/validation.ts'
import {
    getNotificationConfigurationService,
    getNotificationStatusService,
    updateNotificationConfigurationService,
} from '@/server/Admin/Notifications/notifications.service.ts'

function noStore() {
    setResponseHeader('Cache-Control', 'private, no-store')
}

function notificationFailure(error: NotificationDomainError) {
    setResponseStatus(
        error.code === 'configuration_conflict'
            ? 409
            : error.code === 'configuration_unavailable'
              ? 503
              : 422,
    )
    return {
        success: false as const,
        code: error.code,
        message:
            error.code === 'invalid_input' ||
            error.code === 'destination_required' ||
            error.code === 'destination_blocked'
                ? 'errors.invalid_input'
                : 'common.requestFailed',
    }
}

function queryFailure(error: unknown): never {
    if (error instanceof NotificationDomainError) {
        const failure = notificationFailure(error)
        throw new Error(failure.message)
    }
    throwLocalizedQueryError(error, 'common.requestFailed')
}

export const getNotificationConfigurationHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        noStore()
        try {
            return await getNotificationConfigurationService()
        } catch (error) {
            return queryFailure(error)
        }
    },
)

export const getNotificationStatusHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return await getNotificationStatusService()
    } catch (error) {
        return queryFailure(error)
    }
})

export const updateNotificationConfigurationHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => {
        noStore()
        const parsed = updateNotificationConfigurationSchema.safeParse(input)
        if (!parsed.success) {
            setResponseStatus(422)
            throw new Error('errors.invalid_input')
        }
        return parsed.data
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

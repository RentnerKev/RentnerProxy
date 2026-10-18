import '@tanstack/react-start/server-only'

import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import type { z } from 'zod'
import { throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'
import { NotificationDomainError } from './notification.errors.ts'

export function noStore() {
    setResponseHeader('Cache-Control', 'private, no-store')
}

export function validateNotificationInput<T extends z.ZodType>(
    schema: T,
    input: unknown,
): z.output<T> {
    noStore()
    const parsed = schema.safeParse(input)
    if (!parsed.success) {
        setResponseStatus(422)
        throw new Error('errors.invalid_input')
    }
    return parsed.data
}

export function notificationFailure(error: NotificationDomainError) {
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
            error.code === 'configuration_conflict'
                ? 'account.notifications.conflict'
                : error.code === 'invalid_input' ||
                    error.code === 'destination_required' ||
                    error.code === 'destination_blocked'
                  ? 'errors.invalid_input'
                  : 'common.requestFailed',
    }
}

export function notificationQueryFailure(error: unknown): never {
    if (error instanceof NotificationDomainError)
        throw new Error(notificationFailure(error).message)
    throwLocalizedQueryError(error, 'common.requestFailed')
}

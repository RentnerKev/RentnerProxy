import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { NotificationDomainError } from '@/server/Notifications/notification.errors.ts'
import type { NotificationRouteFixture } from './Types/middleware.types.ts'

const routes: NotificationRouteFixture[] = []
const headers = new Map<string, string>()
let status = 200
let failure: unknown = null
const runService = mock(async () => {
    if (failure) throw failure
    return { revision: 1 }
})

mock.module('@tanstack/react-start', () => ({
    createServerFn: ({ method }: { method: 'GET' | 'POST' }) => {
        let validate: NotificationRouteFixture['validate'] = null
        const builder = {
            validator: (validator: NonNullable<NotificationRouteFixture['validate']>) => {
                validate = validator
                return builder
            },
            handler: (handle: NotificationRouteFixture['handle']) => {
                routes.push({ method, validate, handle })
                return handle
            },
        }
        return builder
    },
}))
mock.module('@tanstack/react-start/server', () => ({
    setResponseHeader: (name: string, value: string) => {
        headers.set(name, value)
    },
    setResponseStatus: (value: number) => {
        status = value
    },
    getRequest: () => new Request('https://example.test'),
    getRequestIP: () => '127.0.0.1',
}))
mock.module('@/server/Admin/Notifications/notifications.service.ts', () => ({
    getNotificationConfigurationService: runService,
    getNotificationStatusService: runService,
    updateNotificationConfigurationService: runService,
}))

await import('@/features/Admin/Notifications/middleware.ts')

beforeEach(() => {
    headers.clear()
    status = 200
    failure = null
    runService.mockClear()
})

describe('notification admin transport', () => {
    test('uses GET for configuration and status and validated POST for updates', async () => {
        expect(routes.map((route) => route.method)).toEqual(['GET', 'GET', 'POST'])
        const mutation = routes[2]!
        expect(mutation.validate?.({ expectedRevision: 0, enabled: false, channels: [] })).toEqual({
            expectedRevision: 0,
            enabled: false,
            channels: [],
        })
        expect(
            await mutation.handle({ data: { expectedRevision: 0, enabled: false, channels: [] } }),
        ).toEqual({ success: true, value: { revision: 1 } })
        expect(headers.get('Cache-Control')).toBe('private, no-store')
    })

    test.each(['authentication_required', 'permission_denied'] as const)(
        'preserves common auth mapping for %s GET/POST',
        async (code) => {
            failure = new AuthDomainError(code, 'Private authorization details')
            await expect(routes[0]!.handle({ data: undefined })).rejects.toThrow(`errors.${code}`)
            expect(status).toBe(code === 'authentication_required' ? 401 : 403)
            expect(headers.get('Cache-Control')).toBe('private, no-store')
            expect(
                await routes[2]!.handle({
                    data: { expectedRevision: 0, enabled: false, channels: [] },
                }),
            ).toEqual({ success: false, message: `errors.${code}` })
            expect(status).toBe(code === 'authentication_required' ? 401 : 403)
        },
    )

    test('domain failures return fixed safe codes and never expose destinations', async () => {
        failure = new NotificationDomainError('destination_blocked')
        expect(await routes[2]!.handle({ data: {} })).toEqual({
            success: false,
            code: 'destination_blocked',
            message: 'errors.invalid_input',
        })
        expect(status).toBe(422)
        failure = new NotificationDomainError('configuration_conflict')
        expect(await routes[2]!.handle({ data: {} })).toEqual({
            success: false,
            code: 'configuration_conflict',
            message: 'account.notifications.conflict',
        })
        expect(status).toBe(409)
        failure = new Error('https://private-target.test bearer-private-token')
        expect(await routes[2]!.handle({ data: {} })).toEqual({
            success: false,
            message: 'common.requestFailed',
        })
        expect(status).toBe(503)
    })

    test('invalid boundary input is no-store and never invokes the service', () => {
        expect(() =>
            routes[2]!.validate?.({
                expectedRevision: 0,
                enabled: false,
                channels: [],
                secret: 'private',
            }),
        ).toThrow('errors.invalid_input')
        expect(headers.get('Cache-Control')).toBe('private, no-store')
        expect(status).toBe(422)
        expect(runService).not.toHaveBeenCalled()
    })
})

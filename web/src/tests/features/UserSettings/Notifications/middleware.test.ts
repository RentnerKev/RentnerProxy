import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { NotificationDomainError } from '@/server/Notifications/notification.errors.ts'
import type { PersonalNotificationRouteFixture } from './Types/middleware.types.ts'

const routes: PersonalNotificationRouteFixture[] = []
const headers = new Map<string, string>()
let status = 200
let failure: unknown = null
const runService = mock(async () => {
    if (failure) throw failure
    return { safe: true }
})

mock.module('@tanstack/react-start', () => ({
    createServerFn: ({ method }: { method: 'GET' | 'POST' }) => {
        let validate: PersonalNotificationRouteFixture['validate'] = null
        const builder = {
            validator: (validator: NonNullable<PersonalNotificationRouteFixture['validate']>) => {
                validate = validator
                return builder
            },
            handler: (handle: PersonalNotificationRouteFixture['handle']) => {
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
mock.module('@/server/UserSettings/Notifications/notifications.service.ts', () => ({
    getPersonalNotificationSettingsService: runService,
    getPersonalNotificationStatusService: runService,
    updatePersonalNotificationConfigurationService: runService,
    testPersonalNotificationChannelService: runService,
}))

await import('@/features/UserSettings/Notifications/middleware.ts')
beforeEach(() => {
    headers.clear()
    status = 200
    failure = null
    runService.mockClear()
})

describe('personal notification server function boundary', () => {
    test('uses two GET queries and strict POST mutations with no-store on every response', async () => {
        expect(routes.map((route) => route.method)).toEqual(['GET', 'GET', 'POST', 'POST'])
        expect(routes[2]!.validate?.({ expectedRevision: 0, channels: [] })).toEqual({
            expectedRevision: 0,
            channels: [],
        })
        const probe = { expectedRevision: 3, channelId: '00000000-0000-4000-8000-000000000001' }
        expect(routes[3]!.validate?.(probe)).toEqual(probe)
        await Promise.all(
            routes.map(async (route) => {
                const result = await route.handle({ data: probe })
                expect(result).toEqual(
                    route.method === 'GET'
                        ? { safe: true }
                        : { success: true, value: { safe: true } },
                )
                expect(headers.get('Cache-Control')).toBe('private, no-store')
            }),
        )
    })

    test('rejects ownership injection and unknown test inputs before service calls', () => {
        for (const index of [2, 3]) {
            expect(() =>
                routes[index]!.validate?.({
                    expectedRevision: 0,
                    channels: [],
                    ownerUserId: 'other',
                }),
            ).toThrow('errors.invalid_input')
            expect(status).toBe(422)
            expect(headers.get('Cache-Control')).toBe('private, no-store')
        }
        expect(runService).not.toHaveBeenCalled()
    })

    test('maps permission errors and conflicts without disclosing underlying details', async () => {
        failure = new AuthDomainError('permission_denied', 'private account details')
        await expect(routes[0]!.handle({ data: undefined })).rejects.toThrow(
            'errors.permission_denied',
        )
        expect(status).toBe(403)
        failure = new NotificationDomainError('configuration_conflict')
        await Promise.all(
            [2, 3].map(async (index) => {
                expect(await routes[index]!.handle({ data: {} })).toEqual({
                    success: false,
                    code: 'configuration_conflict',
                    message: 'account.notifications.conflict',
                })
                expect(status).toBe(409)
            }),
        )
        failure = new Error('https://private-target.test private-authorization-token')
        expect(await routes[3]!.handle({ data: {} })).toEqual({
            success: false,
            message: 'common.requestFailed',
        })
        expect(status).toBe(503)
    })
})

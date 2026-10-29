import { describe, expect, test } from 'bun:test'

import { createDevelopmentEnvironment } from '../../../../../scripts/development/environment.ts'

describe('managed development environment', () => {
    test('marks the native Windows controller without changing the parent environment', () => {
        const environment = { PATH: 'tools', RENTNERPROXY_CONTROLLER_TOKEN: 'synthetic-test-token' }
        expect(createDevelopmentEnvironment(environment, 'win32')).toEqual({
            ...environment,
            RENTNERPROXY_NATIVE_CONTROLLER_DEV: '1',
        })
        expect(environment).not.toHaveProperty('RENTNERPROXY_NATIVE_CONTROLLER_DEV')
    })

    test.each(['linux', 'darwin'] as const)(
        'never propagates the native Windows marker on %s',
        (platform) => {
            expect(
                createDevelopmentEnvironment(
                    { RENTNERPROXY_NATIVE_CONTROLLER_DEV: '1', PATH: 'tools' },
                    platform,
                ),
            ).toEqual({ PATH: 'tools', RENTNERPROXY_CONTROLLER_TOKEN: expect.any(String) })
        },
    )

    test('generates independent unpredictable tokens without changing the parent environment', () => {
        const environment = { PATH: 'tools' }
        const first = createDevelopmentEnvironment(environment, 'linux')
        const second = createDevelopmentEnvironment(environment, 'linux')
        expect(first.RENTNERPROXY_CONTROLLER_TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/u)
        expect(second.RENTNERPROXY_CONTROLLER_TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/u)
        expect(first.RENTNERPROXY_CONTROLLER_TOKEN).not.toBe(second.RENTNERPROXY_CONTROLLER_TOKEN)
        expect(environment).not.toHaveProperty('RENTNERPROXY_CONTROLLER_TOKEN')
    })

    test('preserves configured direct and file token sources', () => {
        for (const environment of [
            { RENTNERPROXY_CONTROLLER_TOKEN: 'synthetic-configured-token' },
            { RENTNERPROXY_CONTROLLER_TOKEN_FILE: '/run/secrets/controller-token' },
        ]) {
            expect(createDevelopmentEnvironment(environment, 'linux')).toEqual(environment)
        }
    })
})

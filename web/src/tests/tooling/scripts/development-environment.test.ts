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
            ).toEqual({ PATH: 'tools' })
        },
    )
})

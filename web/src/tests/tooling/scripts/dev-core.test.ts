import { describe, expect, test } from 'bun:test'

import { createControllerDevelopmentEnvironment } from '../../../../../scripts/dev-core.ts'

describe('controller development environment', () => {
    test('ignores native Windows Caddy without mutating the shared environment', () => {
        const environment = {
            RENTNERPROXY_CADDY_BIN: 'C:\\tools\\caddy.exe',
            RENTNERPROXY_CONTROLLER_TOKEN: 'synthetic-controller-token-for-testing',
            RENTNERPROXY_CONTROLLER_LISTEN_ADDR: '127.0.0.1:8081',
            PATH: 'C:\\tools',
        }

        const controllerEnvironment = createControllerDevelopmentEnvironment(environment, 'win32')

        expect(controllerEnvironment.RENTNERPROXY_CADDY_BIN).toBeUndefined()
        expect(controllerEnvironment.RENTNERPROXY_CONTROLLER_TOKEN).toBe(
            environment.RENTNERPROXY_CONTROLLER_TOKEN,
        )
        expect(controllerEnvironment.RENTNERPROXY_CONTROLLER_LISTEN_ADDR).toBe('127.0.0.1:8081')
        expect(controllerEnvironment.PATH).toBe(environment.PATH)
        expect(environment.RENTNERPROXY_CADDY_BIN).toBe('C:\\tools\\caddy.exe')
    })

    test.each(['linux', 'darwin'] as const)('preserves the Caddy runtime on %s', (platform) => {
        const environment = {
            RENTNERPROXY_CADDY_BIN: '/usr/bin/caddy',
            RENTNERPROXY_PROXY_STATE_DIR: '/var/lib/rentnerproxy/proxy',
        }

        expect(createControllerDevelopmentEnvironment(environment, platform)).toEqual(environment)
    })

    test('supports native development with Caddy already unset', () => {
        expect(createControllerDevelopmentEnvironment({}, 'win32')).toEqual({})
    })

    test.each(['win32', 'linux'] as const)(
        'passes the intended Caddy configuration to a real child process on %s',
        async (platform) => {
            const child = Bun.spawn({
                cmd: [
                    process.execPath,
                    '--no-env-file',
                    '-e',
                    'process.stdout.write(JSON.stringify(process.env.RENTNERPROXY_CADDY_BIN ?? null))',
                ],
                env: createControllerDevelopmentEnvironment(
                    { ...process.env, RENTNERPROXY_CADDY_BIN: '/usr/bin/caddy' },
                    platform,
                ),
                stdout: 'pipe',
                stderr: 'pipe',
            })

            const [exitCode, stdout, stderr] = await Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ])

            expect(exitCode).toBe(0)
            expect(stderr).toBe('')
            expect(JSON.parse(stdout)).toBe(platform === 'win32' ? null : '/usr/bin/caddy')
        },
    )
})

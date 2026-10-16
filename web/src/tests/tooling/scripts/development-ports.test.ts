import { describe, expect, test } from 'bun:test'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

import {
    assertDevelopmentPortAvailable,
    getDevelopmentPorts,
} from '../../../../../scripts/development/ports.ts'

describe('development port preflight', () => {
    test('uses the Vite port and the configured IPv4 or IPv6 controller address', () => {
        expect(getDevelopmentPorts({})).toEqual([
            { label: 'Controller', hostname: '127.0.0.1', port: 8081 },
            { label: 'Web server', hostname: 'localhost', port: 5173 },
        ])
        expect(
            getDevelopmentPorts({ RENTNERPROXY_CONTROLLER_LISTEN_ADDR: '[::1]:9091' })[0],
        ).toEqual({ label: 'Controller', hostname: '::1', port: 9091 })
        expect(
            getDevelopmentPorts({ RENTNERPROXY_CONTROLLER_LISTEN_ADDR: '0.0.0.0:9092' })[0],
        ).toEqual({ label: 'Controller', hostname: '0.0.0.0', port: 9092 })
    })

    test.each(['', 'localhost:8081', '127.0.0.1:65536', '127.0.0.1:-1', 'invalid-address'])(
        'rejects an invalid controller address before starting services: %s',
        (address) => {
            expect(() =>
                getDevelopmentPorts({ RENTNERPROXY_CONTROLLER_LISTEN_ADDR: address }),
            ).toThrow('RENTNERPROXY_CONTROLLER_LISTEN_ADDR must be a valid IP address and port.')
        },
    )

    test('rejects a real occupied port without starting children and releases successful probes', async () => {
        const blocker = createServer()
        await new Promise<void>((resolve, reject) => {
            blocker.once('error', reject)
            blocker.listen({ host: '127.0.0.1', port: 0 }, resolve)
        })
        const address = blocker.address()
        if (address === null || typeof address === 'string') throw new Error('Missing test port')
        const endpoint = { label: 'Controller', hostname: '127.0.0.1', port: address.port }

        try {
            await expect(assertDevelopmentPortAvailable(endpoint)).rejects.toThrow(
                `Controller port ${address.port} is already in use.`,
            )
            const child = Bun.spawn({
                cmd: [process.execPath, '--no-env-file', 'scripts/dev.ts'],
                cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
                env: {
                    ...process.env,
                    RENTNERPROXY_CONTROLLER_LISTEN_ADDR: `127.0.0.1:${address.port}`,
                },
                stdout: 'pipe',
                stderr: 'pipe',
            })
            const [exitCode, stdout, stderr] = await Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ])
            expect(exitCode).toBe(1)
            expect(stdout + stderr).toContain('is already in use')
            expect(stdout + stderr).not.toContain('Starting web server')
            expect(stdout + stderr).not.toContain('Starting controller')
        } finally {
            await new Promise<void>((resolve, reject) => {
                blocker.close((error) => (error ? reject(error) : resolve()))
            })
        }

        await assertDevelopmentPortAvailable(endpoint)
        await assertDevelopmentPortAvailable(endpoint)
    })
})

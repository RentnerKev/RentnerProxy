// oxlint-disable no-await-in-loop -- Wait only for the owned listener's bounded readiness deadline.
import { afterEach, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyCoverageFixtureModules } from '@/tests/Helpers/coverageFixture.ts'

const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
const prefix = join(tmpdir(), 'rentnerproxy-serve-runtime-')
const fixtures: string[] = []
afterEach(async () => {
    await Promise.all(
        fixtures.splice(0).map(async (directory) => {
            if (!resolve(directory).startsWith(resolve(prefix)))
                throw new Error('Unsafe fixture cleanup.')
            await rm(directory, { recursive: true, force: true })
        }),
    )
})

async function fixture(port: number, application = true) {
    const directory = await mkdtemp(prefix)
    fixtures.push(directory)
    const code = join(directory, 'code')
    await copyCoverageFixtureModules(code, ['docker/web/serve.ts'], {
        '../../web/dist/server/realtimeWebSocket.js': pathToFileURL(
            join(root, 'web/src/server/WebSockets/realtimeWebSocket.ts'),
        ).href,
    })
    await mkdir(join(code, 'web/dist/server'), { recursive: true })
    await mkdir(join(code, 'web/dist/client/assets'), { recursive: true })
    await writeFile(join(code, 'web/dist/client/assets/app.js'), 'window.fixture=true')
    const marker = join(directory, 'shutdown.json')
    await writeFile(
        join(code, 'web/dist/server/server.js'),
        `
        import {writeFile} from 'node:fs/promises'
        process.on('rentnerproxy:shutdown',pending=>pending.push(writeFile(${JSON.stringify(marker)},'completed')))
        export default ${application ? `{fetch(request){return Response.json({path:new URL(request.url).pathname,ip:request.ip??null})}}` : '{}'}
    `,
    )
    const child = Bun.spawn(
        [process.execPath, '--no-env-file', join(code, 'docker/web/serve.ts')],
        {
            env: {
                ...process.env,
                HOST: '127.0.0.1',
                PORT: String(port),
                PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
            },
            stdout: 'ignore',
            stderr: 'pipe',
        },
    )
    return { directory, marker, child }
}

test.skipIf(process.platform !== 'linux').each(['SIGTERM', 'SIGINT'] as const)(
    'web launcher serves private requests/static assets/live upgrades and drains shutdown on %s',
    async (signal) => {
        const reservation = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: () => new Response(),
        })
        const port = reservation.port!
        await reservation.stop(true)
        const context = await fixture(port)
        const origin = `http://127.0.0.1:${port}`
        try {
            const deadline = Date.now() + 5000
            while (true) {
                try {
                    if ((await fetch(origin + '/ready')).ok) break
                } catch {}
                if (Date.now() > deadline) throw new Error('Owned web fixture readiness timed out.')
                await Bun.sleep(20)
            }
            expect(await (await fetch(origin + '/dynamic')).json()).toEqual({
                path: '/dynamic',
                ip: '127.0.0.1',
            })
            expect(await (await fetch(origin + '/assets/app.js')).text()).toBe(
                'window.fixture=true',
            )
            const download = await fetch(
                origin + '/api/admin/backups/00000000-0000-4000-8000-000000000001/download',
            )
            expect(download.status).toBe(200)
            expect(await download.json()).toMatchObject({ ip: '127.0.0.1' })
            const upgraded = await new Promise<string>((resolveResponse, reject) => {
                const websocketNonce = randomBytes(16).toString('base64')
                const socket = createConnection({ host: '127.0.0.1', port })
                socket.setTimeout(3000, () =>
                    socket.destroy(new Error('Fixture upgrade timed out.')),
                )
                socket.once('error', reject)
                socket.once('connect', () =>
                    socket.write(
                        `GET /api/live HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${websocketNonce}\r\n\r\n`,
                    ),
                )
                socket.once('data', (data) => {
                    resolveResponse(data.toString('utf8'))
                    socket.destroy()
                })
            })
            expect(upgraded.startsWith('HTTP/1.1 101'), upgraded.split('\r\n')[0]).toBe(true)
            context.child.kill(signal)
            expect(await context.child.exited).toBe(0)
            expect(await readFile(context.marker, 'utf8')).toBe('completed')
        } finally {
            if (context.child.exitCode === null) context.child.kill('SIGKILL')
            await context.child.exited
        }
    },
    10_000,
)

test.each([
    [0, true],
    [65536, true],
    [3000, false],
] as const)(
    'web launcher rejects invalid port/application before binding (%s)',
    async (port, application) => {
        const context = await fixture(port, application)
        expect(await context.child.exited).toBe(1)
    },
)

import { describe, expect, test } from 'bun:test'
import { startFixtureServers } from '../../../../../scripts/runtime-reliability/fixture-transport.ts'
import { commandSchema } from '../../../../../scripts/runtime-reliability/fixture.validation.ts'
import { normalizeForwardHost } from '../../../lib/Admin/ProxyHostManagement/proxyHostValidation.ts'
import {
    caddyTransportErrors,
    createTrafficObserver,
    hostFetchCode,
} from '../../../../../scripts/runtime-reliability/transport-diagnostics.ts'

const request = (port: number, init?: RequestInit) => fetch('http://127.0.0.1:' + port + '/', init)

describe('isolated runtime fixture transport', () => {
    test('retains backend, forwarded headers and awaited fault/auth state contracts', async () => {
        const servers = startFixtureServers({
            primaryPort: 0,
            secondaryPort: 0,
            authPort: 0,
            controlPort: 0,
            tlsPort: 0,
        })
        const control = async (body: unknown) => {
            const response = await request(servers.control.port!, {
                method: 'POST',
                body: JSON.stringify(body),
            })
            expect(response.status).toBe(200)
        }
        try {
            const primary = await request(servers.primary.port!, {
                headers: { 'Remote-User': 'fixture-user', 'X-Forwarded-For': '192.0.2.1' },
            })
            expect(await primary.json()).toEqual({
                backend: 'a',
                user: 'fixture-user',
                forwardedFor: '192.0.2.1',
            })
            expect((await (await request(servers.secondary.port!)).json()).backend).toBe('b')
            await control({ upstreamFailed: true })
            expect((await request(servers.primary.port!)).status).toBe(503)
            expect((await request(servers.secondary.port!)).status).toBe(503)
            await control({ upstreamFailed: false })
            expect((await request(servers.primary.port!)).status).toBe(200)
            await control({ authMode: 'deny' })
            expect((await request(servers.auth.port!)).status).toBe(401)
            await control({ authMode: 'unavailable' })
            expect((await request(servers.auth.port!)).status).toBe(503)
            await control({ authMode: 'allow' })
            expect((await request(servers.auth.port!)).headers.get('Remote-User')).toBe(
                'reliability-user',
            )
            expect(
                (
                    await request(servers.control.port!, {
                        method: 'POST',
                        body: JSON.stringify({ authMode: 'private-value' }),
                    })
                ).status,
            ).toBe(400)
            expect((await request(servers.auth.port!)).status).toBe(200)
            expect(
                (
                    await request(servers.control.port!, {
                        method: 'POST',
                        body: JSON.stringify({ upstreamFailed: true, authMode: 'deny' }),
                    })
                ).status,
            ).toBe(400)
            expect((await request(servers.primary.port!)).status).toBe(200)
        } finally {
            servers.stop()
        }
    })
    test('validates network-local hostname for current and Alpha6 fixture adapters', () => {
        const input = {
            runId: '12345678abcd',
            phase: 'prepare',
            upstreamPort: 9000,
            secondaryPort: 9001,
        }
        expect(commandSchema.parse(input).upstreamHost).toBe('fixture-upstream')
        expect(normalizeForwardHost(commandSchema.parse(input).upstreamHost)).toBe(
            'fixture-upstream',
        )
        expect(
            commandSchema.parse({ ...input, upstreamHost: 'host.docker.internal' }).upstreamHost,
        ).toBe('host.docker.internal')
        expect(
            commandSchema.safeParse({ ...input, upstreamHost: 'private.example/token' }).success,
        ).toBe(false)
    })
})

describe('traffic failure diagnostics', () => {
    test('first unexpected 4xx route survives later concurrent successes and network failures', async () => {
        const observer = createTrafficObserver()
        const first = { route: 4, status: 404, hostFetchCode: null }
        await Promise.all([
            Promise.resolve().then(() => {
                observer.observe(first)
                observer.recordFailure(first)
            }),
            Promise.resolve().then(() => {
                observer.observe({ route: 5, status: 200, hostFetchCode: null })
                observer.recordFailure({
                    route: 6,
                    status: null,
                    hostFetchCode: 'ConnectionRefused',
                })
            }),
        ])
        expect(observer.observation).toEqual(first)
        observer.clearHealthyObservation()
        observer.observe({ route: 7, status: 200, hostFetchCode: null })
        expect(observer.observation).toEqual(first)
        observer.reset()
        expect(observer.observation).toBeNull()
        const next = { route: 1, status: null, hostFetchCode: 'TimeoutError' }
        observer.recordFailure(next)
        observer.recordFailure({ route: 2, status: 502, hostFetchCode: null })
        expect(observer.observation).toEqual(next)
    })
    test('expected negative HTTP statuses do not freeze an unrelated subsequent failure', () => {
        const observer = createTrafficObserver()
        observer.observe({ route: 0, status: 404, hostFetchCode: null })
        observer.observe({ route: 1, status: 503, hostFetchCode: null })
        observer.clearHealthyObservation()
        expect(observer.observation).toBeNull()
        const failure = { route: 2, status: 400, hostFetchCode: null }
        observer.recordFailure(failure)
        expect(observer.observation).toEqual(failure)
    })
    const secret = 'private-token-header-body-key-url'
    const line = (msg: string, status = 502) =>
        JSON.stringify({
            level: 'error',
            logger: 'http.log.error',
            msg,
            status,
            request: { headers: { Authorization: secret }, body: secret, uri: secret },
            privateKey: secret,
            error: secret,
        })
    test('classifies new TCP dial separately from reset/EOF without exposing raw fields', () => {
        const events = caddyTransportErrors(
            [
                line('dial tcp private.example:9000: i/o timeout ' + secret),
                line('dial tcp private.example:9000: connect: connection refused'),
                line('read: connection reset by peer'),
                line('unexpected EOF'),
                line('x509: unknown authority ' + secret),
                line('unrecognized ' + secret),
            ].join('\n'),
        )
        expect(events.map((event) => event.category)).toEqual([
            'tcp-dial-timeout',
            'tcp-dial-refused',
            'connection-reset',
            'unexpected-eof',
            'tls-failure',
            'upstream-error',
        ])
        expect(events.map((event) => event.newTcpDial)).toEqual([
            true,
            true,
            false,
            false,
            false,
            false,
        ])
        expect(JSON.stringify(events)).not.toContain(secret)
        expect(JSON.stringify(events)).not.toContain('private.example')
    })
    test.each([
        ['dial udp 192.0.2.1:53: i/o timeout', 'upstream-error'],
        ['dial tcp: lookup fixture-upstream on 127.0.0.11:53: read udp: i/o timeout', 'dns-lookup'],
    ] as const)('does not report a new TCP connection for %s', (message, category) => {
        expect(caddyTransportErrors(line(message))).toEqual([
            { category, status: 502, newTcpDial: false },
        ])
    })
    test('bounds events and excludes malformed/unknown loggers/statuses', () => {
        expect(
            caddyTransportErrors(
                Array.from({ length: 50 }, () => line('dial tcp x:1: i/o timeout')).join('\n'),
            ),
        ).toHaveLength(8)
        expect(
            caddyTransportErrors('garbage\nnull\n[]\n' + line('dial tcp x:1: i/o timeout', 200)),
        ).toEqual([])
        expect(
            caddyTransportErrors(
                JSON.stringify({ level: 'error', logger: secret, status: 502, msg: secret }),
            ),
        ).toEqual([])
        expect(caddyTransportErrors(line('lookup x: no such host'))[0]?.category).toBe('dns-lookup')
        expect(caddyTransportErrors(line('timeout awaiting response headers'))[0]?.category).toBe(
            'response-timeout',
        )
    })
    test('fetch error code output is allowlisted even for hostile error payloads', () => {
        expect(hostFetchCode({ code: 'ConnectionRefused', message: secret })).toBe(
            'ConnectionRefused',
        )
        expect(hostFetchCode({ name: 'TimeoutError', message: secret })).toBe('TimeoutError')
        expect(hostFetchCode({ code: secret, name: secret })).toBe('unexpected')
        expect(hostFetchCode(null)).toBe('unexpected')
    })
})

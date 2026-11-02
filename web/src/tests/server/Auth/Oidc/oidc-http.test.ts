import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { IncomingMessage, ClientRequest } from 'node:http'
import type { RequestOptions } from 'node:https'
import { createOidcHttpFetch } from '@/server/Auth/Oidc/oidc-http.server.ts'
import type { OidcHttpOptions } from '@/server/Auth/Oidc/Types/oidc-client.types.ts'
import type { OidcClientConfiguration } from '@/server/Auth/Oidc/Types/oidc.types.ts'

const configuration: OidcClientConfiguration = {
    providerId: 'provider',
    revision: 1,
    issuer: 'https://issuer.example',
    clientId: 'client',
    clientSecret: 'test-only',
    tokenEndpointAuthMethod: 'client_secret_basic',
    allowedEndpointOrigins: ['https://issuer.example'],
    allowedPrivateCidrs: [],
}
const init = { method: 'GET', headers: {}, body: undefined, redirect: 'manual' as const }

function transport(
    status: number,
    chunks: string[],
    headers: Record<string, string> = {},
    hang = false,
) {
    let observed: RequestOptions | undefined
    let requests = 0
    let destroyed = false
    const request: NonNullable<OidcHttpOptions['request']> = (options, listener) => {
        observed = options
        requests++
        const emitter = new EventEmitter()
        const response = Object.assign(new PassThrough(), { statusCode: status, headers })
        const abort = () => {
            destroyed = true
            response.destroy()
            emitter.emit('error', new Error('aborted'))
        }
        options.signal?.addEventListener('abort', abort, { once: true })
        const cleanup = () => options.signal?.removeEventListener('abort', abort)
        const outgoing = Object.assign(emitter, {
            destroy: () => {
                destroyed = true
                cleanup()
                return outgoing
            },
            end: () => {
                queueMicrotask(() => {
                    listener(response as unknown as IncomingMessage)
                    if (hang) return
                    for (const chunk of chunks) if (!response.destroyed) response.write(chunk)
                    if (!response.destroyed) response.end()
                    cleanup()
                })
                return outgoing
            },
        })
        return outgoing as unknown as ClientRequest
    }
    return { request, state: () => ({ observed, requests, destroyed }) }
}

describe('OIDC bounded pinned HTTPS', () => {
    test('pins a checked DNS answer and retains hostname TLS identity and Host', async () => {
        const mock = transport(200, ['{"keys":[]}'], { 'content-type': 'application/json' })
        const fetch = createOidcHttpFetch(configuration, {
            resolve: async () => ['8.8.8.8', '1.1.1.1'],
            request: mock.request,
        })
        expect(await (await fetch('https://issuer.example/jwks', init)).json()).toEqual({
            keys: [],
        })
        expect(mock.state().observed).toMatchObject({
            hostname: '8.8.8.8',
            servername: 'issuer.example',
            rejectUnauthorized: true,
            agent: false,
            headers: { Host: 'issuer.example' },
            maxHeaderSize: 8192,
        })
        expect(mock.state().observed?.checkServerIdentity).toBeFunction()
    })
    test.each([
        'http://issuer.example/token',
        'https://user:pass@issuer.example/token',
        'https://issuer.example/token#fragment',
        'https://issuer.example/token?secret=value',
        'https://evil.example/token',
        'https://169.254.169.254/token',
    ])('rejects unsafe endpoint %s before DNS or request', async (url) => {
        let dns = 0
        const mock = transport(200, ['{}'])
        const fetch = createOidcHttpFetch(configuration, {
            resolve: async () => {
                dns++
                return ['8.8.8.8']
            },
            request: mock.request,
        })
        await expect(fetch(url, init)).rejects.toMatchObject({
            code: 'provider_unavailable',
            message: 'provider_unavailable',
        })
        expect(dns).toBe(0)
        expect(mock.state().requests).toBe(0)
    })
    test.each([
        ['8.8.8.8', '127.0.0.1'],
        ['8.8.8.8', '169.254.169.254'],
        ['::ffff:127.0.0.1'],
        ['10.1.2.3'],
        [],
    ])('rejects all mixed/blocked DNS answer sets', async (...addresses) => {
        const mock = transport(200, ['{}'])
        const fetch = createOidcHttpFetch(configuration, {
            resolve: async () => addresses,
            request: mock.request,
        })
        await expect(fetch(configuration.issuer + '/token', init)).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
        expect(mock.state().requests).toBe(0)
    })
    test('permits explicit private CIDR but always denies metadata addresses', async () => {
        const mock = transport(200, ['{}'])
        const privateConfiguration = { ...configuration, allowedPrivateCidrs: ['10.0.0.0/8'] }
        const fetch = createOidcHttpFetch(privateConfiguration, {
            resolve: async () => ['10.1.2.3'],
            request: mock.request,
        })
        expect((await fetch(configuration.issuer + '/token', init)).status).toBe(200)
        const blocked = createOidcHttpFetch(
            { ...configuration, allowedPrivateCidrs: ['fd00::/8'] },
            { resolve: async () => ['fd00:ec2::254'], request: mock.request },
        )
        await expect(blocked(configuration.issuer + '/token', init)).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
    })
    test.each([
        [302, ['{}'], { location: 'https://other.example' }],
        [200, ['{}'], { 'content-length': '262145' }],
        [200, ['a'.repeat(200_000), 'a'.repeat(100_000)], { 'content-length': '2' }],
        [200, ['{}'], { 'content-encoding': 'gzip' }],
    ])('rejects redirects/oversized/encoded response (%s)', async (status, chunks, headers) => {
        const mock = transport(status, chunks, headers)
        const fetch = createOidcHttpFetch(configuration, {
            resolve: async () => ['8.8.8.8'],
            request: mock.request,
        })
        await expect(fetch(configuration.issuer + '/token', init)).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
        expect(mock.state().requests).toBe(1)
        expect(mock.state().destroyed).toBe(true)
    })
    test('DNS deadline prevents late answers from sending requests', async () => {
        let release!: (value: readonly string[]) => void
        const mock = transport(200, ['{}'])
        const fetch = createOidcHttpFetch(configuration, {
            timeoutMs: 10,
            resolve: () =>
                new Promise((resolve) => {
                    release = resolve
                }),
            request: mock.request,
        })
        await expect(fetch(configuration.issuer + '/token', init)).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
        release(['8.8.8.8'])
        await Promise.resolve()
        expect(mock.state().requests).toBe(0)
    })
    test('full body read has a deadline and aborts pinned request', async () => {
        const mock = transport(200, [], {}, true)
        const fetch = createOidcHttpFetch(configuration, {
            timeoutMs: 10,
            resolve: async () => ['8.8.8.8'],
            request: mock.request,
        })
        await expect(fetch(configuration.issuer + '/token', init)).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
        expect(mock.state().destroyed).toBe(true)
    })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, type Server, type RequestListener } from 'node:http'
import {
    deliverWebhookNotification,
    createWebhookSystemResolver,
} from '@/server/Notifications/webhook-delivery.ts'
import { lookup } from 'node:dns/promises'
import { getEventListeners } from 'node:events'
import { deliverNotification } from '@/server/Notifications/delivery.service.ts'
import { createServer as createTcpServer } from 'node:net'
import { PAYLOAD } from './Types/transport-test.types.ts'

const servers: Server[] = []
afterEach(() => {
    for (const server of servers.splice(0)) {
        server.closeAllConnections()
        server.close()
    }
})

async function receiver(handler: RequestListener, bindAddress = '127.0.0.1') {
    const server = createServer(handler)
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, bindAddress, resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture')
    return {
        kind: 'webhook' as const,
        url: `http://127.0.0.1:${address.port}/event`,
        authorizationToken: null,
        allowedPrivateCidrs: ['127.0.0.1/32'],
    }
}

describe('bounded webhook delivery', () => {
    test('default system lookup reaches a hosts-file localhost receiver', async () => {
        const addresses = await lookup('localhost', { all: true, verbatim: true })
        expect(addresses.length).toBeGreaterThan(0)
        const destination = await receiver((_request, response) => {
            response.writeHead(204)
            response.end()
        }, addresses[0]!.address)
        destination.url = destination.url.replace('127.0.0.1', 'localhost')
        destination.allowedPrivateCidrs.push('::1/128')
        expect(await deliverWebhookNotification(destination, PAYLOAD)).toEqual({ success: true })
    })
    test('an uncooperative lookup cannot hold a delivery open or send after late resolution', async () => {
        let release!: (addresses: readonly string[]) => void
        const lookupPending = new Promise<readonly string[]>((resolve) => {
            release = resolve
        })
        let requests = 0
        let lookupSignal: AbortSignal | undefined
        const destination = {
            kind: 'webhook' as const,
            url: 'https://receiver.invalid/',
            authorizationToken: null,
            allowedPrivateCidrs: [],
        }
        const result = await deliverWebhookNotification(destination, PAYLOAD, undefined, {
            dnsTimeoutMs: 20,
            resolve: (_hostname, signal) => {
                lookupSignal = signal
                return lookupPending
            },
            request: () => {
                requests++
                throw new Error('unexpected network request')
            },
        })
        expect(result).toEqual({ success: false, code: 'timeout', retryable: true })
        expect(getEventListeners(lookupSignal!, 'abort')).toHaveLength(0)
        release(['8.8.8.8'])
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(requests).toBe(0)
    }, 1_000)
    test('system lookups coalesce, retain independent subscribers and cap outstanding OS work at sixteen hosts', async () => {
        const releases = new Map<string, (addresses: readonly string[]) => void>()
        let calls = 0
        const resolver = createWebhookSystemResolver((hostname) => {
            calls++
            return new Promise((resolve) => {
                releases.set(hostname, resolve)
            })
        })
        const controllers = Array.from({ length: 16 }, () => new AbortController())
        const pending = controllers.map((controller, index) =>
            resolver(`receiver-${index}.invalid`, controller.signal).catch(() => null),
        )
        const second = new AbortController()
        const coalesced = resolver('receiver-0.invalid', second.signal)
        await Promise.resolve()
        expect(calls).toBe(16)
        await expect(resolver('overflow.invalid', new AbortController().signal)).rejects.toThrow(
            'destination_unavailable',
        )
        controllers[0]!.abort()
        expect(await pending[0]).toBeNull()
        for (const controller of controllers) controller.abort()
        await Promise.all(pending)
        // Cancellation removes subscribers, but cannot free still-running OS work
        // and thereby admit an unbounded stream of replacement lookups.
        await expect(
            resolver('cancelled-overflow.invalid', new AbortController().signal),
        ).rejects.toThrow('destination_unavailable')
        releases.get('receiver-0.invalid')!(['127.0.0.1'])
        expect(await coalesced).toEqual(['127.0.0.1'])
        expect(getEventListeners(second.signal, 'abort')).toHaveLength(0)
        const next = resolver('next.invalid', new AbortController().signal)
        await Promise.resolve()
        expect(calls).toBe(17)
        releases.get('next.invalid')!(['8.8.8.8'])
        expect(await next).toEqual(['8.8.8.8'])
        for (const controller of controllers) controller.abort()
        await Promise.all(pending)
        for (const release of releases.values()) release([])
    })
    test('DNS deadline aborts the resolver and is part of the total attempt deadline', async () => {
        let cancelled = false
        const result = await deliverWebhookNotification(
            {
                kind: 'webhook',
                url: 'https://receiver.invalid',
                authorizationToken: null,
                allowedPrivateCidrs: [],
            },
            PAYLOAD,
            undefined,
            {
                dnsTimeoutMs: 20,
                resolve: (_hostname, signal) =>
                    new Promise((_resolve, reject) => {
                        signal.addEventListener(
                            'abort',
                            () => {
                                cancelled = true
                                reject(new Error('private resolver detail'))
                            },
                            { once: true },
                        )
                    }),
            },
        )
        expect(result).toEqual({ success: false, code: 'timeout', retryable: true })
        expect(cancelled).toBe(true)
    })
    test('pinned HTTPS connects to the validated IP and sends original DNS hostname as TLS SNI', async () => {
        let hello = Buffer.alloc(0)
        const server = createTcpServer((socket) => {
            socket.on('data', (chunk) => {
                hello = Buffer.concat([
                    hello,
                    typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
                ])
            })
            socket.resume()
        })
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('fixture')
        try {
            expect(
                await deliverWebhookNotification(
                    {
                        kind: 'webhook',
                        url: `https://tls-receiver.invalid:${address.port}/`,
                        authorizationToken: null,
                        allowedPrivateCidrs: ['127.0.0.1/32'],
                    },
                    PAYLOAD,
                    undefined,
                    { timeoutMs: 100, resolve: async () => ['127.0.0.1'] },
                ),
            ).toEqual({ success: false, code: 'timeout', retryable: true })
            expect(hello.includes(Buffer.from('tls-receiver.invalid'))).toBe(true)
        } finally {
            server.close()
        }
    })
    test('posts payload with stable identifiers and pinned address/original host', async () => {
        let received = ''
        let host = ''
        const destination = await receiver((request, response) => {
            host = request.headers.host ?? ''
            expect(request.headers['idempotency-key']).toBe(PAYLOAD.id)
            request.on('data', (chunk) => {
                received += chunk.toString()
            })
            request.on('end', () => {
                response.writeHead(204)
                response.end()
            })
        })
        const original = new URL(destination.url)
        destination.url = destination.url.replace('127.0.0.1', 'does-not-resolve.invalid')
        expect(
            await deliverWebhookNotification(destination, PAYLOAD, undefined, {
                resolve: async () => ['127.0.0.1'],
            }),
        ).toEqual({ success: true })
        expect(host).toBe(`does-not-resolve.invalid:${original.port}`)
        expect(JSON.parse(received)).toEqual(PAYLOAD)
    })
    test('rejects every DNS set containing a forbidden answer', async () => {
        const destination = await receiver((_request, response) => {
            response.end()
        })
        destination.url = destination.url.replace('127.0.0.1', 'receiver.invalid')
        expect(
            await deliverWebhookNotification(destination, PAYLOAD, undefined, {
                resolve: async () => ['127.0.0.1', '169.254.169.254'],
            }),
        ).toEqual({ success: false, code: 'destination_blocked', retryable: false })
    })
    test('transport boundary strips unexpected sensitive payload fields and closes unlimited responses', async () => {
        let received = ''
        const destination = await receiver((request, response) => {
            request.on('data', (chunk: Buffer) => {
                received += chunk.toString()
            })
            request.on('end', () => {
                response.writeHead(200)
                response.write('x'.repeat(64 * 1_024))
            })
        })
        expect(
            await deliverNotification(destination, {
                ...PAYLOAD,
                secret: 'must-not-leave',
            } as typeof PAYLOAD),
        ).toEqual({ success: true })
        expect(JSON.parse(received)).toEqual(PAYLOAD)
        expect(received).not.toContain('must-not-leave')
    })
    test('never follows redirects and safely classifies retry responses', async () => {
        await Promise.all(
            [302, 400, 408, 429, 503].map(async (status) => {
                const destination = await receiver((_request, response) => {
                    response.writeHead(status, {
                        Location: 'http://169.254.169.254/',
                        'Retry-After': '99999999',
                    })
                    response.end('secret')
                })
                const result = await deliverWebhookNotification(destination, PAYLOAD)
                expect(result).toEqual(
                    status === 302
                        ? { success: false, code: 'redirect_denied', retryable: false }
                        : {
                              success: false,
                              code: 'http_rejected',
                              retryable: status !== 400,
                              ...(status === 400 ? {} : { retryAfterMs: 3_600_000 }),
                          },
                )
            }),
        )
    })
    test('destroys slow sockets on deadline and abort, rejects oversized payloads', async () => {
        let closed = 0
        const destination = await receiver((request) => {
            request.socket.on('close', () => {
                closed++
            })
        })
        expect(
            await deliverWebhookNotification(destination, PAYLOAD, undefined, { timeoutMs: 30 }),
        ).toEqual({ success: false, code: 'timeout', retryable: true })
        const controller = new AbortController()
        const attempt = deliverWebhookNotification(destination, PAYLOAD, controller.signal)
        setTimeout(() => controller.abort(), 30)
        expect(await attempt).toEqual({ success: false, code: 'cancelled', retryable: false })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(closed).toBe(2)
        expect(
            await deliverWebhookNotification(destination, {
                ...PAYLOAD,
                resourceId: 'x'.repeat(20_000),
            }),
        ).toEqual({ success: false, code: 'payload_limit', retryable: false })
    })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, request as httpsRequest, type Server } from 'node:https'
import type { Socket } from 'node:net'
import { deliverWebhookNotification } from '@/server/Notifications/webhook-delivery.ts'
import { PAYLOAD } from './Types/transport-test.types.ts'
import { TLS_TEST_CA, TLS_TEST_CERTIFICATE, TLS_TEST_KEY } from './Types/tls-test.types.ts'

const servers: Server[] = []
const sockets = new Set<Socket>()

afterEach(async () => {
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    await Promise.all(
        servers
            .splice(0)
            .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    )
})

describe('notification HTTPS certificate boundaries', () => {
    test.each([
        ['trusted matching certificate', 'notification-tls.invalid', true, true],
        ['trusted wrong-host certificate', 'wrong-host.invalid', true, false],
        ['untrusted matching certificate', 'notification-tls.invalid', false, false],
    ] as const)(
        '%s preserves certificate verification while connecting to the pinned IP',
        async (_name, hostname, trustFixtureCa, successful) => {
            let requests = 0
            let receivedHost = ''
            let receivedSni = ''
            let transportError = false
            const server = createServer(
                { key: TLS_TEST_KEY, cert: TLS_TEST_CERTIFICATE },
                (request, response) => {
                    requests++
                    receivedHost = request.headers.host ?? ''
                    request.resume()
                    request.once('end', () => {
                        response.writeHead(204)
                        response.end()
                    })
                },
            )
            server.on('connection', (socket) => {
                sockets.add(socket)
                socket.once('close', () => sockets.delete(socket))
            })
            server.on('secureConnection', (socket) => {
                receivedSni = socket.servername || ''
            })
            server.on('tlsClientError', () => {})
            servers.push(server)
            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
            const address = server.address()
            if (!address || typeof address === 'string') throw new Error('fixture')

            const result = await deliverWebhookNotification(
                {
                    kind: 'webhook',
                    url: `https://${hostname}:${address.port}/event`,
                    authorizationToken: null,
                    allowedPrivateCidrs: ['127.0.0.1/32'],
                },
                PAYLOAD,
                undefined,
                {
                    timeoutMs: 2_000,
                    resolve: async () => ['127.0.0.1'],
                    request: (options, listener) => {
                        expect(options.hostname).toBe('127.0.0.1')
                        expect(options.servername).toBe(hostname)
                        expect(options.rejectUnauthorized).toBe(true)
                        expect(options.checkServerIdentity).toBeFunction()
                        // Trust only this synthetic CA. Preserve the production hostname verifier.
                        const request = httpsRequest(
                            { ...options, ...(trustFixtureCa ? { ca: TLS_TEST_CA } : {}) },
                            listener,
                        )
                        request.once('error', () => {
                            transportError = true
                        })
                        return request
                    },
                },
            )

            expect(result).toEqual(
                successful
                    ? { success: true }
                    : { success: false, code: 'destination_unavailable', retryable: true },
            )
            expect(requests).toBe(successful ? 1 : 0)
            expect(transportError).toBe(!successful)
            if (successful) {
                expect(receivedHost).toBe(`${hostname}:${address.port}`)
                expect(receivedSni).toBe(hostname)
            }
        },
    )
})

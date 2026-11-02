import { describe, expect, test } from 'bun:test'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

// The journey module constructs a lazy database client; these tests use loopback HTTP only.
const originalDatabase = process.env.DATABASE_URL
process.env.DATABASE_URL ??= 'postgresql://unit:unit@127.0.0.1:1/rentnerproxy_unit'
const { requestBeta2Proxy } = await import('../../../../../.github/scripts/ci/beta2/journeys.ts')
if (originalDatabase === undefined) delete process.env.DATABASE_URL

async function withProxy(
    handler: (request: IncomingMessage, response: ServerResponse) => void,
    operation: (port: number) => Promise<void>,
) {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected loopback fixture port')
    try {
        await operation(address.port)
    } finally {
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        )
    }
}

describe('Beta 2 proxy probe connection ownership', () => {
    test('finishes each probe socket before a following route generation is served', async () => {
        const sockets = new Set<Socket>()
        const closed: Promise<unknown>[] = []
        const hosts: string[] = []
        await withProxy(
            (request, response) => {
                sockets.add(request.socket)
                closed.push(once(request.socket, 'close'))
                hosts.push(request.headers.host ?? '')
                response.setHeader('Content-Type', 'application/json')
                response.end(JSON.stringify({ backend: hosts.length === 1 ? 'a' : 'b' }))
            },
            async (port) => {
                expect((await requestBeta2Proxy(port, 'old.beta2.test')).body.backend).toBe('a')
                await closed[0]
                expect((await requestBeta2Proxy(port, 'new.beta2.test')).body.backend).toBe('b')
                await closed[1]
                expect(sockets.size).toBe(2)
                expect(hosts).toEqual(['old.beta2.test', 'new.beta2.test'])
                expect([...sockets].every((socket) => socket.destroyed)).toBe(true)
            },
        )
    })
    test('propagates a real transport reset without retrying or fabricating a route response', async () => {
        let requests = 0
        await withProxy(
            (request) => {
                requests += 1
                request.socket.destroy()
            },
            async (port) => {
                await expect(requestBeta2Proxy(port)).rejects.toMatchObject({ code: 'ECONNRESET' })
                expect(requests).toBe(1)
            },
        )
    })
    test('preserves unavailable routes and rejects malformed successful upstream bodies', async () => {
        await withProxy(
            (request, response) => {
                response.setHeader('Content-Type', 'application/json')
                if (request.headers.host === 'missing.beta2.test') {
                    response.statusCode = 503
                    response.end('unavailable')
                } else response.end(JSON.stringify({ backend: 'unowned' }))
            },
            async (port) => {
                expect((await requestBeta2Proxy(port, 'missing.beta2.test')).status).toBe(503)
                await expect(requestBeta2Proxy(port)).rejects.toThrow()
            },
        )
    })
})

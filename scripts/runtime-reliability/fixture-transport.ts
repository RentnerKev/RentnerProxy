import { fixtureTransport } from './fixture-transport.config.ts'
import type { FixturePorts } from './Types/fixture-transport.types.ts'

export function startFixtureServers(ports: FixturePorts) {
    let upstreamFailed = false
    let authMode: 'allow' | 'deny' | 'unavailable' = 'allow'
    let tls: ReturnType<typeof Bun.serve> | undefined
    const backend = (name: string, port: number) =>
        Bun.serve({
            hostname: '0.0.0.0',
            port,
            idleTimeout: fixtureTransport.idleTimeout,
            fetch(request) {
                if (upstreamFailed) return new Response(null, { status: 503 })
                return Response.json({
                    backend: name,
                    user: request.headers.get('Remote-User'),
                    forwardedFor: request.headers.get('X-Forwarded-For'),
                })
            },
        })
    const primary = backend('a', ports.primaryPort)
    const secondary = backend('b', ports.secondaryPort)
    const auth = Bun.serve({
        hostname: '0.0.0.0',
        port: ports.authPort,
        idleTimeout: fixtureTransport.idleTimeout,
        fetch() {
            if (authMode === 'unavailable') return new Response(null, { status: 503 })
            if (authMode === 'deny') return new Response(null, { status: 401 })
            return new Response(null, {
                status: 200,
                headers: { 'Remote-User': 'reliability-user' },
            })
        },
    })
    // Control is reachable only through exec inside this owned fixture container.
    const control = Bun.serve({
        hostname: '127.0.0.1',
        port: ports.controlPort,
        async fetch(request) {
            if (request.method === 'GET') return new Response(null, { status: 200 })
            if (request.method !== 'POST') return new Response(null, { status: 405 })
            let input: unknown
            try {
                input = await request.json()
            } catch {
                return new Response(null, { status: 400 })
            }
            if (!input || typeof input !== 'object' || Array.isArray(input))
                return new Response(null, { status: 400 })
            const record = input as Record<string, unknown>
            if (Object.keys(record).length !== 1) return new Response(null, { status: 400 })
            if (typeof record.upstreamFailed === 'boolean') upstreamFailed = record.upstreamFailed
            else if (
                record.authMode === 'allow' ||
                record.authMode === 'deny' ||
                record.authMode === 'unavailable'
            )
                authMode = record.authMode
            else if (record.startTls === true && !tls) {
                tls = Bun.serve({
                    hostname: '0.0.0.0',
                    port: ports.tlsPort,
                    idleTimeout: fixtureTransport.idleTimeout,
                    tls: {
                        key: Bun.file('/tmp/fixture-leaf.key'),
                        cert: Bun.file('/tmp/fixture-leaf.pem'),
                    },
                    fetch: () => Response.json({ backend: 'tls' }),
                })
            } else return new Response(null, { status: 400 })
            return new Response(null, { status: 200 })
        },
    })
    return {
        primary,
        secondary,
        auth,
        control,
        stop() {
            primary.stop(true)
            secondary.stop(true)
            auth.stop(true)
            control.stop(true)
            tls?.stop(true)
        },
    }
}

if (import.meta.main) startFixtureServers(fixtureTransport)

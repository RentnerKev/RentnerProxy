import { LIVE_SNAPSHOT_PATH } from './src/websockets/Helpers/realtimeConstants'
import { createLiveWebSocketRuntime } from './src/websockets/Server/realtimeWebSocket'
import type { LiveSocketData } from './src/websockets/Types/bun'
import type { Plugin, UserConfig, ViteDevServer } from 'vite'

const LIVE_PROXY_PATH = '/api/live'

function originHost(host: string | boolean | undefined): string {
    if (host === true || host === '0.0.0.0' || host === '::') return 'localhost'
    return typeof host === 'string' && host.length > 0 ? host : 'localhost'
}

function createDevelopmentOrigin(config: UserConfig): string {
    const host = originHost(config.server?.host)
    const port = config.server?.port ?? 5173
    return `http://${host}:${port}`
}

export function createLiveVitePlugin(): Plugin {
    let runtime: ReturnType<typeof createLiveWebSocketRuntime> | null = null
    let sidecar: Bun.Server<LiveSocketData> | null = null
    let localOrigin: { value: string } | null = null
    const configuredOrigin = process.env.RENTNERPROXY_PUBLIC_ORIGIN?.trim()
    let cleaned = false

    function cleanup(): void {
        if (cleaned) return
        cleaned = true
        const closingRuntime = runtime
        const closingSidecar = sidecar
        runtime = null
        sidecar = null
        void closingRuntime?.shutdown()
        closingSidecar?.stop(true)
    }

    return {
        name: 'rentnerproxy-live-transport',
        config(config, env) {
            if (env.command !== 'serve') return

            localOrigin = { value: createDevelopmentOrigin(config) }
            runtime = createLiveWebSocketRuntime({
                allowedOrigin: () => configuredOrigin ?? localOrigin?.value ?? null,
                readSnapshot: (request) => {
                    const localOriginValue = localOrigin?.value
                    if (!localOriginValue)
                        return Promise.resolve(new Response(null, { status: 503 }))
                    const target = new URL(LIVE_SNAPSHOT_PATH, localOriginValue)
                    target.search = new URL(request.url).search
                    const headers = new Headers()
                    const cookie = request.headers.get('cookie')
                    const originHeader = request.headers.get('origin')
                    if (cookie !== null) headers.set('cookie', cookie)
                    if (originHeader !== null) headers.set('origin', originHeader)
                    return fetch(
                        new Request(target, { method: 'GET', headers, signal: request.signal }),
                    )
                },
            })
            sidecar = Bun.serve({
                hostname: '127.0.0.1',
                port: 0,
                websocket: runtime.websocket,
                fetch: async (request, bunServer) => {
                    const result = await runtime?.handle(request, bunServer)
                    if (result?.handled) return result.response
                    return new Response(null, { status: 404 })
                },
            })
            if (sidecar.port === undefined) throw new Error('Live transport sidecar did not bind.')

            return {
                server: {
                    proxy: {
                        [LIVE_PROXY_PATH]: {
                            target: `ws://127.0.0.1:${sidecar.port}`,
                            ws: true,
                            changeOrigin: false,
                            bypass(request) {
                                return /^\/api\/live(?:\?|$)/u.test(request.url ?? '')
                                    ? undefined
                                    : request.url
                            },
                        },
                    },
                },
            }
        },
        configureServer(server: ViteDevServer) {
            if (!localOrigin || !server.httpServer) return
            const updateOrigin = () => {
                const resolved = server.resolvedUrls?.local[0]
                if (resolved) localOrigin!.value = new URL(resolved).origin
            }
            if (server.resolvedUrls) updateOrigin()
            else server.httpServer.once('listening', updateOrigin)
            server.httpServer.once('close', cleanup)
        },
        closeBundle() {
            cleanup()
        },
    }
}

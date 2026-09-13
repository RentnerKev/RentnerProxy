import { createRuntimeFetch } from './request-context.ts'
import { createStaticAssetFetch } from './static-assets.ts'
import { createLiveWebSocketRuntime } from '../../web/src/websockets/Server/realtimeWebSocket.ts'
import { fileURLToPath } from 'node:url'

const { default: application } = await import('../../web/dist/server/server.js')

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const hostname = process.env.HOST ?? '0.0.0.0'
const clientRoot = fileURLToPath(new URL('../../web/dist/client/', import.meta.url))

if (!Number.isInteger(port) || port < 1 || port > 65_535 || !application?.fetch) {
    process.exit(1)
}

const runtimeFetch = createRuntimeFetch(application)
const live = createLiveWebSocketRuntime({
    allowedOrigin: process.env.RENTNERPROXY_PUBLIC_ORIGIN ?? 'http://localhost:5173',
    readSnapshot: (request) => application.fetch(request),
})
const staticAssetFetch = createStaticAssetFetch(clientRoot, runtimeFetch)
const server = Bun.serve({
    hostname,
    port,

    maxRequestBodySize: 12 * 1024 * 1024,
    websocket: live.websocket,
    fetch: async (request, bunServer) => {
        const result = await live.handle(request, bunServer)
        if (result.handled) return result.response
        return staticAssetFetch(request, bunServer)
    },
})

let shuttingDown = false

async function shutdown() {
    if (shuttingDown) return
    shuttingDown = true

    const forceExit = setTimeout(() => process.exit(1), 18_000)
    try {
        const pending = []
        process.emit('rentnerproxy:shutdown', pending)
        pending.push(live.shutdown())
        await Promise.all([server.stop(false), ...pending])
        process.exitCode = 0
    } finally {
        clearTimeout(forceExit)
        process.exit()
    }
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

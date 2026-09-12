import { createRuntimeFetch } from './request-context.ts'
import { createStaticAssetFetch } from './static-assets.ts'
import { fileURLToPath } from 'node:url'

const { default: application } = await import('../../web/dist/server/server.js')

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const hostname = process.env.HOST ?? '0.0.0.0'
const clientRoot = fileURLToPath(new URL('../../web/dist/client/', import.meta.url))

if (!Number.isInteger(port) || port < 1 || port > 65_535 || !application?.fetch) {
    process.exit(1)
}

const runtimeFetch = createRuntimeFetch(application)
const server = Bun.serve({
    hostname,
    port,

    maxRequestBodySize: 12 * 1024 * 1024,
    fetch: createStaticAssetFetch(clientRoot, runtimeFetch),
})

let shuttingDown = false

async function shutdown() {
    if (shuttingDown) return
    shuttingDown = true

    const forceExit = setTimeout(() => process.exit(1), 18_000)
    try {
        const pending = []
        process.emit('rentnerproxy:shutdown', pending)
        await Promise.all([server.stop(false), ...pending])
        process.exitCode = 0
    } finally {
        clearTimeout(forceExit)
        process.exit()
    }
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

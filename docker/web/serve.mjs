import { createRuntimeFetch } from './request-context.ts'

const { default: application } = await import('../../web/dist/server/server.js')

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const hostname = process.env.HOST ?? '0.0.0.0'

if (!Number.isInteger(port) || port < 1 || port > 65_535 || !application?.fetch) {
    process.exit(1)
}

const server = Bun.serve({
    hostname,
    port,
    // Fits the 8 MiB avatar limit after base64/JSON encoding.
    maxRequestBodySize: 12 * 1024 * 1024,
    fetch: createRuntimeFetch(application),
})

let shuttingDown = false

async function shutdown() {
    if (shuttingDown) return
    shuttingDown = true

    const forceExit = setTimeout(() => process.exit(1), 18_000)
    try {
        await server.stop(false)
        process.exitCode = 0
    } finally {
        clearTimeout(forceExit)
        process.exit()
    }
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

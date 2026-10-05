// This fixture listens only on its private Docker network.
const admitted = new Set<string>()
const pending = new Set<ReturnType<typeof setTimeout>>()
const server = Bun.serve({
    hostname: '0.0.0.0',
    port: 8088,
    idleTimeout: 90,
    async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/admitted') return Response.json([...admitted])
        if (url.pathname === '/ready') return new Response('ready')
        const id = /^\/hold\/([a-f0-9-]{36})$/u.exec(url.pathname)?.[1]
        const seconds = Number(url.searchParams.get('seconds'))
        if (!id || (seconds !== 16 && seconds !== 60)) {
            return new Response('fixture-path-invalid', { status: 400 })
        }
        admitted.add(id)
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                pending.delete(timer)
                resolve()
            }, seconds * 1000)
            pending.add(timer)
        })
        return new Response('appliance-drain-completed')
    },
})

process.on('SIGTERM', () => {
    for (const timer of pending) clearTimeout(timer)
    server.stop(true)
    process.exit(0)
})

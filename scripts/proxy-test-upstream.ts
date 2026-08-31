interface TestUpstreamOptions {
    readonly hostname?: string
    readonly port?: number
    readonly message?: string
}

export function startTestUpstream(options: TestUpstreamOptions = {}) {
    return Bun.serve({
        hostname: options.hostname ?? '127.0.0.1',
        port: options.port ?? 4_000,
        fetch(request) {
            const url = new URL(request.url)
            return Response.json({
                message: options.message ?? 'RentnerProxy test upstream',
                method: request.method,
                path: url.pathname + url.search,
                host: request.headers.get('host'),
                'x-real-ip': request.headers.get('x-real-ip'),
                'x-forwarded-for': request.headers.get('x-forwarded-for'),
                'x-forwarded-proto': request.headers.get('x-forwarded-proto'),
                upgrade: request.headers.get('upgrade'),
                connection: request.headers.get('connection'),
            })
        },
    })
}

if (import.meta.main) {
    const port = Number(process.env.RENTNERPROXY_TEST_UPSTREAM_PORT ?? 4_000)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error('RENTNERPROXY_TEST_UPSTREAM_PORT must be between 1 and 65535.')
    }

    const upstream = startTestUpstream({
        hostname: process.env.RENTNERPROXY_TEST_UPSTREAM_HOST ?? '127.0.0.1',
        port,
        message: process.env.RENTNERPROXY_TEST_UPSTREAM_MESSAGE ?? 'RentnerProxy test upstream',
    })
    console.log('Test upstream listening at ' + upstream.url)
    const stop = () => {
        void upstream.stop(true)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
}

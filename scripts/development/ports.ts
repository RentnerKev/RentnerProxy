import { createServer, isIP } from 'node:net'

import type { DevelopmentPort } from './Types/development.types.ts'

export function getDevelopmentPorts(
    environment: NodeJS.ProcessEnv = process.env,
): DevelopmentPort[] {
    const address = environment.RENTNERPROXY_CONTROLLER_LISTEN_ADDR ?? '127.0.0.1:8081'
    const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/u.exec(address)
    const hostname = match?.[1]?.replace(/^\[|\]$/gu, '') ?? ''
    const port = Number(match?.[2])

    if (!match || !isIP(hostname) || !Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error('RENTNERPROXY_CONTROLLER_LISTEN_ADDR must be a valid IP address and port.')
    }

    return [
        { label: 'Controller', hostname, port },
        { label: 'Web server', hostname: 'localhost', port: 5173 },
    ]
}

export function assertDevelopmentPortAvailable(endpoint: DevelopmentPort): Promise<void> {
    return new Promise((resolve, reject) => {
        const server = createServer()
        server.once('error', (error: NodeJS.ErrnoException) => {
            reject(
                new Error(
                    error.code === 'EADDRINUSE'
                        ? `${endpoint.label} port ${endpoint.port} is already in use. Stop the existing development session (Ctrl+C), then run bun run dev again.`
                        : `Cannot bind ${endpoint.label} port ${endpoint.port}. Check the listen address and local network permissions.`,
                ),
            )
        })
        server.listen({ host: endpoint.hostname, port: endpoint.port, exclusive: true }, () =>
            server.close((error) => (error ? reject(error) : resolve())),
        )
    })
}

export async function assertDevelopmentPortsAvailable(): Promise<void> {
    await Promise.all(getDevelopmentPorts().map(assertDevelopmentPortAvailable))
}

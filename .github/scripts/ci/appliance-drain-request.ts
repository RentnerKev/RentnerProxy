import http from 'node:http'
import https from 'node:https'
import type { DrainResponse } from './Types/appliance-drain-smoke.types.ts'

export function drainRequest(
    protocol: 'http' | 'https',
    port: number,
    domain: string,
    path: string,
    ca: string,
): Promise<DrainResponse> {
    const started = performance.now()
    return new Promise((resolve) => {
        let finished = false
        const finish = (result: Omit<DrainResponse, 'elapsedMs'>) => {
            if (finished) return
            finished = true
            clearTimeout(timer)
            resolve({ ...result, elapsedMs: Math.round(performance.now() - started) })
        }
        const request = (protocol === 'https' ? https : http).request(
            {
                hostname: '127.0.0.1',
                port,
                path,
                headers: { Host: domain },
                agent: false,
                ...(protocol === 'https' ? { ca, servername: domain } : {}),
            },
            (response) => {
                let body = ''
                response.on('data', (chunk: Buffer) => {
                    body += chunk.toString()
                    if (body.length > 256) request.destroy(new Error('response-bound'))
                })
                response.on('end', () =>
                    finish({
                        ok: response.statusCode === 200 && body === 'appliance-drain-completed',
                        ...(response.statusCode === undefined
                            ? {}
                            : { status: response.statusCode }),
                    }),
                )
                response.on('error', () => finish({ ok: false, error: 'response-error' }))
            },
        )
        const timer = setTimeout(() => request.destroy(new Error('request-deadline')), 45_000)
        request.on('error', (error: NodeJS.ErrnoException) =>
            finish({
                ok: false,
                error: error.code === 'ECONNRESET' ? 'ECONNRESET' : 'request-error',
            }),
        )
        request.end()
    })
}

import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'

export type Http3Command = (
    args: string[],
    options?: { readonly timeoutMs?: number },
) => Promise<string>

export async function buildHttp3Client(command: Http3Command, image: string): Promise<void> {
    await command(
        ['docker', 'build', '--file', 'scripts/http3-client.Dockerfile', '--tag', image, '.'],
        { timeoutMs: 300_000 },
    )
    const version = await command(['docker', 'run', '--rm', image, '--version'])
    assert.match(version, /Features:.*\bHTTP2\b.*\bHTTP3\b/u)
}

interface Http3Request {
    readonly image: string
    readonly caFile: string
    readonly hostname: string
    readonly port: number
    readonly path?: string
    readonly protocol?: '--http3-only' | '--http3' | '--http2' | '--http1.1'
    readonly network?: string
    readonly address?: string
    readonly headers?: readonly string[]
    readonly credentials?: string
}

export async function requestHttp3Client(command: Http3Command, request: Http3Request) {
    const network = request.network ?? (process.platform === 'linux' ? 'host' : undefined)
    const address =
        request.address ?? (process.platform === 'linux' ? '127.0.0.1' : 'host.docker.internal')
    const output = await command(
        [
            'docker',
            'run',
            '--rm',
            ...(network ? ['--network', network] : []),
            '--volume',
            request.caFile + ':/test-ca.pem:ro',
            request.image,
            '--silent',
            '--show-error',
            '--noproxy',
            '*',
            '--max-time',
            '10',
            request.protocol ?? '--http3-only',
            '--cacert',
            '/test-ca.pem',
            '--connect-to',
            `${request.hostname}:${request.port}:${address}:${request.port}`,
            '--include',
            '--write-out',
            '\nRENTNERPROXY_RESULT:%{http_code}:%{http_version}\n%{certs}',
            ...(request.headers ?? []).flatMap((header) => ['--header', header]),
            ...(request.credentials ? ['--user', request.credentials] : []),
            `https://${request.hostname}:${request.port}${request.path ?? '/'}`,
        ],
        { timeoutMs: 20_000 },
    )
    const result = output.match(/\nRENTNERPROXY_RESULT:(\d{3}):([\d.]+)\n/u)
    assert.ok(result, 'HTTP client did not report its negotiated protocol')
    const pem = output
        .slice(result.index)
        .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u)?.[0]
    assert.ok(pem, 'HTTP client did not report the verified peer certificate')
    const fingerprint =
        'sha256:' + new X509Certificate(pem).fingerprint256.replaceAll(':', '').toLowerCase()
    return {
        status: Number(result[1]),
        protocol: result[2],
        fingerprint,
        output: output.slice(0, result.index),
    }
}

export function assertHttp3Response(
    response: Awaited<ReturnType<typeof requestHttp3Client>>,
    status: number,
    publicPort: number,
): void {
    assert.equal(response.protocol, '3')
    assert.equal(response.status, status)
    const advertisements = [...response.output.matchAll(/^alt-svc:\s*(.+)$/gimu)]
    assert.equal(advertisements.length, 1)
    assert.equal(advertisements[0]?.[1]?.trim(), `h3=":${publicPort}"; ma=2592000`)
}

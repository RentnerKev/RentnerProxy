import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function validateBeta2Environment(
    environment: NodeJS.ProcessEnv,
    platform = process.platform,
) {
    assert.equal(platform, 'linux', 'Beta 2 integration requires Linux')
    assert.equal(environment.RENTNERPROXY_BETA2_INTEGRATION, '1', 'explicit Beta 2 opt-in required')
    for (const [name, protocols] of [
        ['DATABASE_URL', ['postgres:', 'postgresql:']],
        ['VALKEY_URL', ['redis:', 'rediss:']],
    ] as const) {
        const url = new URL(environment[name] ?? '')
        assert.ok(
            protocols.some((protocol) => protocol === url.protocol),
            'invalid fixture protocol',
        )
        assert.ok(
            ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
            'loopback fixture required',
        )
        assert.equal(url.search, '', 'fixture URL query parameters are forbidden')
        assert.equal(url.hash, '', 'fixture URL fragment is forbidden')
        if (name === 'DATABASE_URL')
            assert.equal(url.pathname, '/rentnerproxy_beta2_test', 'dedicated fixture DB required')
    }
}

export function beta2Directory(runId: string) {
    assert.match(runId, /^[a-f0-9]{32}$/u, 'invalid fixture run ID')
    return '/tmp/rentnerproxy-beta2-' + runId
}

async function run() {
    validateBeta2Environment(process.env)
    const runId = randomBytes(16).toString('hex')
    const directory = beta2Directory(runId)
    await mkdir(directory, { mode: 0o700 })
    try {
        const cert = join(directory, 'smtp-cert.pem')
        const key = join(directory, 'smtp-key.pem')
        const openssl = Bun.spawn(
            [
                'openssl',
                'req',
                '-x509',
                '-newkey',
                'rsa:2048',
                '-nodes',
                '-days',
                '1',
                '-subj',
                '/CN=Beta2 fixture',
                '-addext',
                'subjectAltName=IP:127.0.0.1',
                '-keyout',
                key,
                '-out',
                cert,
            ],
            { stdout: 'ignore', stderr: 'ignore', timeout: 10_000 },
        )
        assert.equal(await openssl.exited, 0, 'fixture TLS certificate generation failed')
        const child = Bun.spawn(
            [
                process.execPath,
                '--no-env-file',
                fileURLToPath(new URL('./execute.ts', import.meta.url)),
            ],
            {
                cwd: resolve(fileURLToPath(new URL('../../../..', import.meta.url))),
                env: {
                    ...process.env,
                    NODE_EXTRA_CA_CERTS: cert,
                    RENTNERPROXY_BETA2_RUN_ID: runId,
                    RENTNERPROXY_BETA2_DIRECTORY: directory,
                    RENTNERPROXY_BETA2_SMTP_CERT: cert,
                    RENTNERPROXY_BETA2_SMTP_KEY: key,
                },
                stdout: 'inherit',
                stderr: 'inherit',
                timeout: 780_000,
            },
        )
        const interrupted = () => child.kill('SIGTERM')
        process.once('SIGTERM', interrupted)
        process.once('SIGINT', interrupted)
        try {
            assert.equal(await child.exited, 0, 'Beta 2 integration failed')
        } finally {
            process.removeListener('SIGTERM', interrupted)
            process.removeListener('SIGINT', interrupted)
        }
    } finally {
        assert.equal(directory, beta2Directory(runId))
        await rm(directory, { recursive: true, force: true })
    }
}

if (import.meta.main) await run()

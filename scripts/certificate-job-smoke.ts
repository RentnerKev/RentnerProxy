import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { SQL } from 'bun'
import { smokeDockerArguments } from './smoke-resources'

interface JobSmokeOptions {
    readonly controllerUrl: string
    readonly httpUrl: string
    readonly token: string
    readonly backendPort: number
    readonly temporaryDirectory: string
    readonly waitFor: (probe: () => Promise<boolean>, label: string) => Promise<void>
    readonly restartRuntime: () => Promise<void>
    readonly verifyHttps: () => Promise<void>
}

export async function verifyDurableCertificateJob(options: JobSmokeOptions): Promise<void> {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const container = 'rentnerproxy-job-smoke-' + randomUUID().replaceAll('-', '').slice(0, 12)
    const password = randomBytes(24).toString('hex')
    const environment = {
        ...process.env,
        NODE_ENV: 'test',
        APP_URL: 'http://localhost:5173',
        APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        POSTGRES_PASSWORD: password,
        RENTNERPROXY_CONTROLLER_URL: options.controllerUrl,
        RENTNERPROXY_CONTROLLER_TOKEN: options.token,
        RENTNERPROXY_JOB_SMOKE_STATE_FILE: join(options.temporaryDirectory, 'durable-job-id'),
        RENTNERPROXY_JOB_SMOKE_BACKEND_PORT: String(options.backendPort),
        DATABASE_URL: '',
    }
    async function command(args: string[]): Promise<string> {
        const child = Bun.spawn({
            cmd: smokeDockerArguments(args),
            cwd: root,
            env: environment,
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const timer = setTimeout(() => child.kill(), 180_000)
        try {
            const [code, output, error] = await Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ])
            assert.equal(code, 0, `Certificate job fixture command failed: ${error}`)
            return output.trim()
        } finally {
            clearTimeout(timer)
        }
    }
    async function fixture(
        mode: string,
    ): Promise<{ id: string; certificateId: string; stage: string; error: string | null }> {
        const output = await command([process.execPath, 'scripts/certificate-job-fixture.ts', mode])
        return JSON.parse(output.split('\n').at(-1) ?? '{}')
    }
    try {
        await command([
            'docker',
            'run',
            '--detach',
            '--name',
            container,
            '--publish',
            '127.0.0.1::5432',
            '--env',
            'POSTGRES_PASSWORD',
            '--env',
            'POSTGRES_USER=rentnerproxy_smoke',
            '--env',
            'POSTGRES_DB=rentnerproxy_smoke',
            'postgres:18.6@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280',
        ])
        const binding = await command(['docker', 'port', container, '5432/tcp'])
        assert.match(binding, /^127\.0\.0\.1:\d+$/u)
        environment.DATABASE_URL = `postgresql://rentnerproxy_smoke:${password}@${binding}/rentnerproxy_smoke`
        const probe = new SQL(environment.DATABASE_URL)
        try {
            await options.waitFor(async () => {
                await probe`select 1`
                return true
            }, 'certificate job PostgreSQL')
        } finally {
            await probe.close()
        }
        await command([process.execPath, 'run', 'db:migrate'])
        const prepared = await fixture('prepare')
        assert.equal(prepared.stage, 'preparing')
        const unpublished = await fetch(options.httpUrl + '/pending-job', {
            headers: { host: 'certificate-job.example.com' },
            redirect: 'manual',
            signal: AbortSignal.timeout(5_000),
        })
        assert.equal(unpublished.status, 404)
        await unpublished.body?.cancel()
        const accepted = await fixture('tick')
        assert.equal(accepted.id, prepared.id)
        let fingerprint = ''
        await options.waitFor(async () => {
            const response = await fetch(
                `${options.controllerUrl}/internal/v1/certificates/${prepared.certificateId}`,
                {
                    headers: { authorization: 'Bearer ' + options.token },
                    signal: AbortSignal.timeout(5_000),
                },
            )
            if (!response.ok) return false
            const metadata = await response.json()
            if (metadata.status !== 'valid') return false
            fingerprint = metadata.fingerprint
            return true
        }, 'durable job ACME issuance after web process exit')
        await options.restartRuntime()
        await options.waitFor(async () => {
            const result = await fixture('tick')
            assert.equal(result.id, prepared.id)
            assert.equal(result.certificateId, prepared.certificateId)
            return result.stage === 'applied'
        }, 'durable certificate job after web and controller restart')
        const metadataResponse = await fetch(
            `${options.controllerUrl}/internal/v1/certificates/${prepared.certificateId}`,
            {
                headers: { authorization: 'Bearer ' + options.token },
                signal: AbortSignal.timeout(5_000),
            },
        )
        assert.equal((await metadataResponse.json()).fingerprint, fingerprint)
        const redirect = await fetch(options.httpUrl + '/ready-job', {
            headers: { host: 'certificate-job.example.com' },
            redirect: 'manual',
            signal: AbortSignal.timeout(5_000),
        })
        assert.equal(redirect.status, 308)
        await redirect.body?.cancel()
        await options.verifyHttps()
    } finally {
        await command(['docker', 'rm', '--force', '--volumes', container]).catch(() => undefined)
    }
}

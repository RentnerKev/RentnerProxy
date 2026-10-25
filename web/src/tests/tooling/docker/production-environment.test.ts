import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../../..', import.meta.url))

async function render(environment: NodeJS.ProcessEnv, environmentFile = '') {
    const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-compose-environment-'))
    try {
        const envFile = join(directory, 'fixture.env')
        await writeFile(envFile, environmentFile)
        const fixture: NodeJS.ProcessEnv = { ...process.env }
        for (const variable of [
            'PUBLIC_ORIGIN',
            'PROXY_TRUSTED_PROXY_CIDRS',
            'RENTNERPROXY_PUBLIC_ORIGIN',
            'RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS',
        ]) {
            delete fixture[variable]
        }
        Object.assign(fixture, {
            RENTNERPROXY_IMAGE: 'rentnerproxy:fixture',
            SMTP_HOST: 'smtp.example.invalid',
            SMTP_FROM: 'fixture@example.invalid',
            SMTP_USER: 'fixture',
            SMTP_PASSWORD: 'fixture-only',
            SMTP_PORT: '587',
            SMTP_SECURE: 'false',
            ...environment,
        })
        const child = Bun.spawn(
            [
                'docker',
                'compose',
                '--env-file',
                envFile,
                '--file',
                join(root, 'docker-compose.yml'),
                'config',
                '--format=json',
            ],
            { cwd: root, env: fixture, stdout: 'pipe', stderr: 'pipe', timeout: 10_000 },
        )
        const [exit, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        return { exit, stdout, stderr }
    } finally {
        await rm(directory, { force: true, recursive: true })
    }
}

describe.skipIf(Bun.which('docker') === null)('production Compose environment aliases', () => {
    test.each(['new', 'legacy', 'both'] as const)('accepts %s names', async (configuration) => {
        const result = await render({
            ...(configuration !== 'legacy'
                ? {
                      PUBLIC_ORIGIN: 'https://management.example.com',
                      PROXY_TRUSTED_PROXY_CIDRS: '192.0.2.0/24',
                  }
                : {}),
            ...(configuration !== 'new'
                ? {
                      RENTNERPROXY_PUBLIC_ORIGIN: 'https://legacy.example.com',
                      RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS: '2001:db8::/64',
                  }
                : {}),
        })
        expect(result.exit, result.stderr).toBe(0)
        const environment = JSON.parse(result.stdout).services.rentnerproxy.environment
        expect(environment.PUBLIC_ORIGIN).toBe(
            configuration === 'legacy'
                ? 'https://legacy.example.com'
                : 'https://management.example.com',
        )
        expect(environment.PROXY_TRUSTED_PROXY_CIDRS).toBe(
            configuration === 'legacy' ? '2001:db8::/64' : '192.0.2.0/24',
        )
        expect(environment.RENTNERPROXY_PUBLIC_ORIGIN).toBe(
            configuration === 'new' ? null : 'https://legacy.example.com',
        )
        expect(environment.RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS).toBe(
            configuration === 'new' ? null : '2001:db8::/64',
        )
    })

    test('forwards legacy names from the Compose env file for runtime migration warnings', async () => {
        const result = await render(
            {},
            'RENTNERPROXY_PUBLIC_ORIGIN=https://legacy.example.com\nRENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS=192.0.2.0/24\n',
        )
        expect(result.exit, result.stderr).toBe(0)
        const environment = JSON.parse(result.stdout).services.rentnerproxy.environment
        expect(environment.PUBLIC_ORIGIN).toBe('https://legacy.example.com')
        expect(environment.RENTNERPROXY_PUBLIC_ORIGIN).toBe('https://legacy.example.com')
        expect(environment.PROXY_TRUSTED_PROXY_CIDRS).toBe('192.0.2.0/24')
        expect(environment.RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS).toBe('192.0.2.0/24')
    })

    test('keeps an explicitly empty new trust list authoritative', async () => {
        const result = await render({
            PUBLIC_ORIGIN: 'https://management.example.com',
            PROXY_TRUSTED_PROXY_CIDRS: '',
            RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS: '192.0.2.0/24',
        })
        expect(result.exit, result.stderr).toBe(0)
        expect(
            JSON.parse(result.stdout).services.rentnerproxy.environment.PROXY_TRUSTED_PROXY_CIDRS,
        ).toBe('')
    })

    test('leaves an absent origin empty for the appliance startup guard', async () => {
        const result = await render({})
        expect(result.exit, result.stderr).toBe(0)
        expect(JSON.parse(result.stdout).services.rentnerproxy.environment.PUBLIC_ORIGIN).toBe('')
    })
})

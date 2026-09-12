// oxlint-disable no-await-in-loop -- Upgrade phases and bounded readiness probes are sequential.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { smokeCompose } from './smoke-resources'
import { verifyRestoreRollback } from './restore-rollback-smoke'
import {
    assertAlpha1UpgradeFixture,
    seedAlpha1UpgradeFixture,
    type Alpha1UpgradeFixture,
} from './alpha1-upgrade-fixture'

export const ALPHA1_IMAGE =
    'ghcr.io/rentnerkev/rentnerproxy:v1.0.0-alpha.1@sha256:f88edb70a80db7c527e1a963e835593f6998ab4541f810e26cf75ffa63da0d3f'
const ALPHA1_REVISION = 'a147176c6096935dc5d9824f671b5f21d89b636b'
type Command = (argumentsList: string[], timeoutMs?: number) => Promise<string>

interface UpgradeSmokeOptions {
    readonly imageTag: string
    readonly temporaryRoot: string
    readonly upstreamPort: number
    readonly trafficMarker: string
    readonly envFile: string
    readonly environment: NodeJS.ProcessEnv
    readonly command: Command
    readonly commandWithEnvironment: (
        args: string[],
        environment: NodeJS.ProcessEnv,
        timeoutMs?: number,
    ) => Promise<string>
    readonly passed: (label: string) => void
}

async function waitFor(
    operation: () => Promise<boolean>,
    label: string,
    timeoutMs = 240_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (await operation().catch(() => false)) return
        await Bun.sleep(500)
    }
    throw new Error('Upgrade smoke timed out: ' + label)
}

function composeDocument(image: string): string {
    return smokeCompose(
        JSON.stringify({
            services: {
                rentnerproxy: {
                    image,
                    extra_hosts: ['host.docker.internal:host-gateway'],
                    environment: {
                        SMTP_FROM: '${SMTP_FROM:?Set SMTP_FROM}',
                        SMTP_HOST: '${SMTP_HOST:?Set SMTP_HOST}',
                        SMTP_PASSWORD: '${SMTP_PASSWORD:?Set SMTP_PASSWORD}',
                        SMTP_PORT: '${SMTP_PORT:-587}',
                        SMTP_SECURE: '${SMTP_SECURE:-false}',
                        SMTP_USER: '${SMTP_USER:?Set SMTP_USER}',
                    },
                    volumes: ['data:/var/lib/rentnerproxy', 'postgres-base:/var/lib/postgresql'],
                },
            },
            volumes: { data: {}, 'postgres-base': {} },
        }),
    )
}

export async function verifyAlpha1Upgrade(options: UpgradeSmokeOptions): Promise<void> {
    const { command, passed } = options
    const runId = randomUUID().replaceAll('-', '').slice(0, 12)
    const project = 'rentnerproxy-alpha-upgrade-' + runId
    const restoreProject = project + '-restore'
    const directory = join(options.temporaryRoot, 'alpha1-upgrade')
    await mkdir(directory)
    const oldComposeFile = join(directory, 'alpha1.compose.json')
    const newComposeFile = join(directory, 'alpha2.compose.json')
    await writeFile(oldComposeFile, composeDocument(ALPHA1_IMAGE))
    await writeFile(newComposeFile, composeDocument(options.imageTag))
    const compose = (file: string, name = project) => [
        'docker',
        'compose',
        '--env-file',
        options.envFile,
        '--project-name',
        name,
        '--file',
        file,
    ]
    const oldCompose = compose(oldComposeFile)
    const nextCompose = compose(newComposeFile)
    const restoreCompose = compose(newComposeFile, restoreProject)
    const containerId = (args: string[]) => command([...args, 'ps', '--quiet', 'rentnerproxy'])
    const healthy = (id: string) =>
        waitFor(
            async () =>
                (await command([
                    'docker',
                    'inspect',
                    '--format',
                    '{{if .State.Health}}{{.State.Health.Status}}{{end}}',
                    id,
                ])) === 'healthy',
            'appliance readiness',
        )
    const activeRevision = async (id: string): Promise<string> => {
        const source =
            "const token=await Bun.file('/run/rentnerproxy/controller-token/value').text();const response=await fetch('http://127.0.0.1:8081/internal/v1/proxy/status',{headers:{authorization:'Bearer '+token}});if(!response.ok)process.exit(1);const status=await response.json();if(!status.activeRevision)process.exit(1);process.stdout.write(status.activeRevision);"
        return command(['docker', 'exec', '--user', '10001:10001', id, 'bun', '-e', source])
    }
    const traffic = async (id: string, fixture: Alpha1UpgradeFixture): Promise<void> => {
        await command([
            'docker',
            'exec',
            id,
            'bun',
            '-e',
            `await Bun.write('/tmp/alpha1-upgrade-ca.pem',${JSON.stringify(fixture.caPem)})`,
        ])
        for (const host of [fixture.hostDomain, fixture.aliasDomain]) {
            await waitFor(
                async () =>
                    (await command([
                        'docker',
                        'exec',
                        id,
                        'curl',
                        '--fail',
                        '--silent',
                        '--show-error',
                        '--max-time',
                        '5',
                        '--noproxy',
                        '*',
                        '--header',
                        'Host: ' + host,
                        'http://127.0.0.1:8080/upgrade-traffic',
                    ])) === options.trafficMarker,
                'HTTP ' + host,
            )
            assert.equal(
                await command([
                    'docker',
                    'exec',
                    id,
                    'curl',
                    '--fail',
                    '--silent',
                    '--show-error',
                    '--max-time',
                    '5',
                    '--noproxy',
                    '*',
                    '--cacert',
                    '/tmp/alpha1-upgrade-ca.pem',
                    '--resolve',
                    host + ':8443:127.0.0.1',
                    'https://' + host + ':8443/upgrade-traffic',
                ]),
                options.trafficMarker,
            )
        }
        const redirect = await command([
            'docker',
            'exec',
            id,
            'curl',
            '--silent',
            '--show-error',
            '--max-time',
            '5',
            '--noproxy',
            '*',
            '--output',
            '/dev/null',
            '--write-out',
            '%{http_code}\n%{redirect_url}',
            '--header',
            'Host: ' + fixture.redirectDomain,
            'http://127.0.0.1:8080/upgrade-redirect',
        ])
        assert.equal(
            redirect,
            String(fixture.redirectStatus) +
                '\n' +
                fixture.redirectDestination +
                '/upgrade-redirect',
        )
    }
    try {
        await command(['docker', 'pull', '--platform', 'linux/amd64', ALPHA1_IMAGE], 900_000)
        const labels = JSON.parse(
            await command([
                'docker',
                'image',
                'inspect',
                '--format',
                '{{json .Config.Labels}}',
                ALPHA1_IMAGE,
            ]),
        ) as Record<string, string>
        assert.equal(labels['org.opencontainers.image.version'], 'v1.0.0-alpha.1')
        assert.equal(labels['org.opencontainers.image.revision'], ALPHA1_REVISION)
        await command([...oldCompose, 'up', '--detach'], 240_000)
        let id = await containerId(oldCompose)
        await healthy(id)
        const fixture = await seedAlpha1UpgradeFixture({
            containerId: id,
            command,
            upstreamPort: options.upstreamPort,
            runId,
        })
        await assertAlpha1UpgradeFixture({ containerId: id, command, fixture, expectAlpha2: false })
        await traffic(id, fixture)
        const originalRevision = await activeRevision(id)
        passed(
            'published Alpha 1 image starts with real users, roles, hosts, certificates and desired state',
        )

        const backupRoot = join(directory, 'backups')
        await options.commandWithEnvironment(
            [
                process.execPath,
                'scripts/production-backup.ts',
                '--project',
                project,
                '--output',
                backupRoot,
            ],
            { ...options.environment, RENTNERPROXY_COMPOSE_FILE: oldComposeFile },
            900_000,
        )
        const backups = await readdir(backupRoot)
        assert.equal(backups.length, 1)
        const backupPath = join(backupRoot, backups[0]!)
        await command([...oldCompose, 'down', '--remove-orphans'], 180_000)
        await command([...nextCompose, 'up', '--detach'], 240_000)
        id = await containerId(nextCompose)
        await healthy(id)
        await assertAlpha1UpgradeFixture({ containerId: id, command, fixture, expectAlpha2: true })
        await traffic(id, fixture)
        assert.equal(await activeRevision(id), originalRevision)
        passed(
            'in-place Alpha 1 upgrade preserves database records and live HTTP, HTTPS and redirects',
        )

        await command([...nextCompose, 'restart', 'rentnerproxy'], 180_000)
        await healthy(id)
        await assertAlpha1UpgradeFixture({ containerId: id, command, fixture, expectAlpha2: true })
        await traffic(id, fixture)
        assert.equal(await activeRevision(id), originalRevision)
        passed('repeated startup after Alpha 1 upgrade is idempotent')
        await command([...nextCompose, 'down', '--remove-orphans'], 180_000)

        await options.commandWithEnvironment(
            [
                process.execPath,
                'scripts/production-restore.ts',
                '--project',
                restoreProject,
                '--input',
                backupPath,
                '--confirm-replace',
            ],
            { ...options.environment, RENTNERPROXY_COMPOSE_FILE: newComposeFile },
            900_000,
        )
        const restoredId = await containerId(restoreCompose)
        await healthy(restoredId)
        await assertAlpha1UpgradeFixture({
            containerId: restoredId,
            command,
            fixture,
            expectAlpha2: true,
        })
        await traffic(restoredId, fixture)
        assert.equal(await activeRevision(restoredId), originalRevision)
        passed('Alpha 1 database and controller backup restores into a fresh Alpha 2 appliance')
        await verifyRestoreRollback({
            containerId: restoredId,
            command,
            commandWithEnvironment: options.commandWithEnvironment,
            environment: options.environment,
            composeFile: newComposeFile,
            project: restoreProject,
            backupPath,
            temporaryRoot: directory,
            waitForHealthy: () => healthy(restoredId),
        })
        await assertAlpha1UpgradeFixture({
            containerId: restoredId,
            command,
            fixture,
            expectAlpha2: true,
        })
        await traffic(restoredId, fixture)
        assert.equal(await activeRevision(restoredId), originalRevision)
        passed('failed SQL restore rolls back and restarts the unchanged appliance')
    } finally {
        await command([...nextCompose, 'down', '--volumes', '--remove-orphans'], 180_000).catch(
            () => undefined,
        )
        await command([...restoreCompose, 'down', '--volumes', '--remove-orphans'], 180_000).catch(
            () => undefined,
        )
    }
}

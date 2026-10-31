// oxlint-disable no-await-in-loop -- Smoke setup, maintenance, and recovery must run in a fixed order.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { sharedSmokeImage, verifySharedSmokeImage } from '../../../scripts/smoke/images.ts'
import { runMaintenanceProcess } from '../../../scripts/backup/maintenance-process.ts'
import { verifyPublishedBackup } from '../../../scripts/backup/publication.ts'
import {
    SMOKE_RUN_LABEL,
    smokeCompose,
    smokeDockerArguments,
    smokeRunScope,
} from '../../../scripts/smoke/resources.ts'
import {
    managedBackupJobSchema,
    managedBackupStatusSchema,
} from '../../../web/src/lib/Backups/validation.ts'
import type { ManagedBackupStatus } from '../../../web/src/lib/Backups/Types/backups.types.ts'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const containerProbe = '/tmp/managed-backup-probe.js'

export function validateManagedBackupTestImage(value: string): string {
    if (
        value.length > 255 ||
        !/^[a-z0-9]+(?:(?:[._/-]|:[0-9]+\/)[a-z0-9]+)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})?$/u.test(
            value,
        )
    )
        throw new Error('Invalid managed backup test image reference')
    return value
}

export function managedBackupSmokeCompose(image: string, scope: string): string {
    validateManagedBackupTestImage(image)
    const labels = { [SMOKE_RUN_LABEL]: scope }
    return smokeCompose(
        JSON.stringify({
            services: {
                rentnerproxy: {
                    image,
                    restart: 'no',
                    stop_grace_period: '35s',
                    labels,
                    environment: {
                        PUBLIC_ORIGIN: 'https://managed-backup.invalid',
                        PROXY_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
                        SMTP_FROM: 'Managed Backup Fixture <fixture@managed-backup.invalid>',
                        SMTP_HOST: 'smtp.managed-backup.invalid',
                        SMTP_USER: 'fixture',
                        SMTP_PASSWORD: 'isolated-synthetic-fixture',
                        SMTP_PORT: '587',
                        SMTP_SECURE: 'false',
                    },
                    volumes: ['data:/var/lib/rentnerproxy'],
                },
            },
            volumes: { data: { labels } },
            networks: { default: { internal: true, labels } },
        }),
    )
}

async function wait(check: () => Promise<boolean>, operation: string, timeoutMs = 240_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            if (await check()) return
        } catch (error) {
            if (error instanceof assert.AssertionError) throw error
            /* Expected while managed backup consumers are stopped. */
        }
        await Bun.sleep(500)
    }
    throw new Error('Managed backup smoke deadline exceeded: ' + operation)
}

export async function runManagedBackupsSmoke(): Promise<number> {
    const runId = randomUUID().replaceAll('-', '').slice(0, 12)
    const scope = smokeRunScope() ?? 'local-' + runId
    const sourceProject = 'rentnerproxy-managed-source-' + runId
    const targetProject = 'rentnerproxy-managed-restore-' + runId
    const helper = 'rentnerproxy-managed-maintenance-' + runId
    const explicitImage = process.env.RENTNERPROXY_MANAGED_BACKUP_TEST_IMAGE
    const sharedImage = explicitImage === undefined ? sharedSmokeImage('appliance') : undefined
    const image = validateManagedBackupTestImage(
        explicitImage ?? sharedImage ?? 'rentnerproxy-managed-backup-smoke:' + runId,
    )
    const temporary = await mkdtemp(join(tmpdir(), 'rentnerproxy-managed-backups-'))
    await chmod(temporary, 0o700)
    const composeFile = join(temporary, 'compose.json')
    const envFile = join(temporary, 'fixture.env')
    const bundleFile = join(temporary, 'managed-backup-probe.js')
    const backupPath = join(temporary, 'backup')
    const environment: NodeJS.ProcessEnv = {
        ...process.env,
        RENTNERPROXY_SMOKE_RUN: scope,
        COMPOSE_DISABLE_ENV_FILE: 'true',
        COMPOSE_ENV_FILES: envFile,
        RENTNERPROXY_COMPOSE_FILE: composeFile,
    }
    for (const name of [
        'APP_ENCRYPTION_KEY',
        'DATABASE_URL',
        'POSTGRES_PASSWORD',
        'RENTNERPROXY_APP_KEY_FILE',
        'RENTNERPROXY_CONTROLLER_TOKEN',
        'RENTNERPROXY_CONTROLLER_TOKEN_FILE',
        'RENTNERPROXY_IMAGE',
        'PUBLIC_ORIGIN',
        'PROXY_TRUSTED_PROXY_CIDRS',
        'SMTP_FROM',
        'SMTP_HOST',
        'SMTP_USER',
        'SMTP_PASSWORD',
    ])
        delete environment[name]
    const compose = (project: string) => [
        'docker',
        'compose',
        '--env-file',
        envFile,
        '--project-name',
        project,
        '--file',
        composeFile,
    ]
    let checks = 0
    let imageBuilt = false
    let cleanupFailed = false
    let helperCreated = false
    let sourceCreated = false
    let targetCreated = false
    const passed = (message: string) => {
        checks += 1
        console.log('PASS ' + message)
    }
    async function command(args: string[], operation: string, timeoutMs = 60_000) {
        const result = await runMaintenanceProcess(smokeDockerArguments(args), {
            cwd: repositoryRoot,
            env: environment,
            timeoutMs,
            maximumOutputBytes: 1024 * 1024,
        })
        if (result.failed || !result.stopped)
            throw new Error('Managed backup smoke operation failed: ' + operation)
        return Buffer.from(result.stdout).toString('utf8').trim()
    }
    async function bestEffort(args: string[]) {
        try {
            await command(args, 'owned cleanup', 120_000)
        } catch {
            cleanupFailed = true
        }
    }
    async function id(project: string) {
        const value = await command(
            [...compose(project), 'ps', '--all', '--quiet', 'rentnerproxy'],
            'locate owned appliance',
        )
        assert.match(value, /^[a-f0-9]{64}$/u)
        assert.equal(
            await command(
                [
                    'docker',
                    'inspect',
                    '--format',
                    '{{index .Config.Labels "' + SMOKE_RUN_LABEL + '"}}',
                    value,
                ],
                'verify appliance ownership',
            ),
            scope,
        )
        return value
    }
    async function healthy(container: string) {
        await wait(
            async () =>
                (
                    await command(
                        [
                            'docker',
                            'inspect',
                            '--format',
                            '{{if .State.Health}}{{.State.Health.Status}}{{end}}',
                            container,
                        ],
                        'inspect fixture health',
                    )
                ).trim() === 'healthy',
            'healthy fixture',
        )
    }
    async function probe(
        container: string,
        mode: string,
        argument?: string,
        web = false,
    ): Promise<unknown> {
        const output = await command(
            [
                'docker',
                'exec',
                ...(web ? ['--user', '10002:10002'] : []),
                container,
                'bun',
                '--no-env-file',
                containerProbe,
                mode,
                ...(argument ? [argument] : []),
            ],
            'fixture probe ' + mode,
            mode === 'concurrent' ? 200_000 : 60_000,
        )
        return JSON.parse(output) as unknown
    }
    async function status(container: string) {
        assert.equal(
            await command(
                ['docker', 'inspect', '--format', '{{.State.Running}}', container],
                'inspect owned fixture process',
            ),
            'true',
            'owned fixture unexpectedly stopped',
        )
        return managedBackupStatusSchema.parse(await probe(container, 'status'))
    }
    async function completed(container: string, jobId: string) {
        let latest: ManagedBackupStatus | undefined
        await wait(
            async () => {
                latest = await status(container)
                const job = latest.jobs.find((entry) => entry.id === jobId)
                if (job && ['failed', 'interrupted'].includes(job.state))
                    throw new Error('backup did not succeed')
                return job?.state === 'succeeded' && job.retained
            },
            'successful managed backup',
            300_000,
        )
        assert.ok(latest)
        assert.equal(latest.jobs.find((entry) => entry.id === jobId)?.state, 'succeeded')
        await probe(container, 'verify', jobId)
        return latest
    }
    try {
        await writeFile(envFile, '', { mode: 0o600 })
        await writeFile(composeFile, managedBackupSmokeCompose(image, scope), { mode: 0o600 })
        const build = await Bun.build({
            entrypoints: [
                join(repositoryRoot, '.github/scripts/ci/fixtures/managed-backup-probe.ts'),
            ],
            target: 'bun',
            outdir: temporary,
            naming: 'managed-backup-probe.js',
        })
        if (!build.success) throw new Error('Managed backup fixture compilation failed')
        await chmod(bundleFile, 0o644)
        if (sharedImage !== undefined)
            await verifySharedSmokeImage(
                (args, options) =>
                    command(args, 'verify shared appliance image', options?.timeoutMs),
                'appliance',
            )
        if (explicitImage === undefined && sharedImage === undefined) {
            await command(
                [
                    'docker',
                    'build',
                    '--label',
                    SMOKE_RUN_LABEL + '=' + scope,
                    '--file',
                    'docker/production/Dockerfile',
                    '--tag',
                    image,
                    '.',
                ],
                'build fixture appliance',
                1_200_000,
            )
            imageBuilt = true
        }
        // Random project identities are checked before creating anything; no pre-existing state is admitted.
        assert.equal(
            await command(
                [...compose(sourceProject), 'ps', '--all', '--quiet'],
                'check fresh source project',
            ),
            '',
        )
        assert.equal(
            await command(
                [...compose(targetProject), 'ps', '--all', '--quiet'],
                'check fresh restore project',
            ),
            '',
        )
        for (const project of [sourceProject, targetProject]) {
            assert.equal(
                await command(
                    [
                        'docker',
                        'volume',
                        'ls',
                        '--filter',
                        'name=' + project + '_data',
                        '--format',
                        '{{.Name}}',
                    ],
                    'check fresh fixture volume',
                ),
                '',
            )
            assert.equal(
                await command(
                    [
                        'docker',
                        'network',
                        'ls',
                        '--filter',
                        'name=' + project + '_default',
                        '--format',
                        '{{.Name}}',
                    ],
                    'check fresh fixture network',
                ),
                '',
            )
        }
        assert.equal(
            await command(
                [
                    'docker',
                    'container',
                    'ls',
                    '--all',
                    '--filter',
                    'name=^/' + helper + '$',
                    '--format',
                    '{{.ID}}',
                ],
                'check fresh fixture helper',
            ),
            '',
        )
        sourceCreated = true
        await command(
            [...compose(sourceProject), 'up', '--detach', '--pull', 'never'],
            'start source fixture',
            180_000,
        )
        const source = await id(sourceProject)
        await healthy(source)
        await command(
            ['docker', 'cp', bundleFile, source + ':' + containerProbe],
            'install private source probe',
        )
        await probe(source, 'auth')
        await probe(source, 'web-isolation', undefined, true)
        await probe(source, 'seed')
        await probe(source, 'configure')
        passed('controller authentication and web UID backup isolation')

        const first = managedBackupJobSchema.parse(await probe(source, 'concurrent'))
        await completed(source, first.id)
        passed(
            'concurrent start admission, busy response, idempotency, and verified managed artifact',
        )
        const second = managedBackupJobSchema.parse(await probe(source, 'start'))
        const retained = await completed(source, second.id)
        assert.equal(retained.jobs.find((job) => job.id === first.id)?.retained, false)
        await probe(source, 'absent', first.id)
        passed('retention deletes only the previous canonical backup after a verified replacement')

        const interrupted = managedBackupJobSchema.parse(await probe(source, 'start'))
        await probe(source, 'active', interrupted.id)
        await command(
            ['docker', 'kill', source],
            'interrupt owned source during active maintenance',
        )
        await command(['docker', 'start', source], 'restart interrupted fixture', 60_000)
        await healthy(source)
        const recovered = await status(source)
        assert.equal(recovered.jobs.find((job) => job.id === interrupted.id)?.state, 'interrupted')
        assert.equal(recovered.jobs.find((job) => job.id === second.id)?.retained, true)
        await probe(source, 'verify', second.id)
        passed(
            'abrupt maintenance restart marks interrupted work and preserves the previous good backup',
        )

        await command(
            ['docker', 'stop', '--time', '35', source],
            'stop source before offline schedule fixture',
        )
        const volume = sourceProject + '_data'
        assert.equal(
            await command(
                [
                    'docker',
                    'volume',
                    'inspect',
                    '--format',
                    '{{index .Labels "' + SMOKE_RUN_LABEL + '"}}',
                    volume,
                ],
                'verify private source volume ownership',
            ),
            scope,
        )
        helperCreated = true
        await command(
            [
                'docker',
                'create',
                '--name',
                helper,
                '--label',
                SMOKE_RUN_LABEL + '=' + scope,
                '--network',
                'none',
                '--volume',
                volume + ':/var/lib/rentnerproxy',
                '--entrypoint',
                'bun',
                image,
                '--no-env-file',
                containerProbe,
                'schedule',
            ],
            'create offline schedule fixture',
        )
        await command(
            ['docker', 'cp', bundleFile, helper + ':' + containerProbe],
            'install offline schedule probe',
        )
        const scheduledBefore = z
            .strictObject({ scheduledBefore: z.number().int().nonnegative() })
            .parse(
                JSON.parse(
                    await command(
                        ['docker', 'start', '--attach', helper],
                        'inject missed schedule into stopped fixture',
                    ),
                ),
            ).scheduledBefore
        assert.equal(
            await command(
                ['docker', 'inspect', '--format', '{{.State.ExitCode}}', helper],
                'verify offline fixture exit',
            ),
            '0',
        )
        await command(['docker', 'rm', helper], 'remove offline schedule fixture')
        helperCreated = false
        await command(['docker', 'start', source], 'restart missed-schedule fixture')
        let scheduled: ManagedBackupStatus | undefined
        await wait(
            async () => {
                scheduled = await status(source)
                const jobs = scheduled.jobs.filter((job) => job.origin === 'schedule')
                assert.ok(jobs.length <= scheduledBefore + 1)
                return jobs.length === scheduledBefore + 1 && jobs.at(-1)?.state === 'succeeded'
            },
            'one missed-schedule catch-up backup',
            300_000,
        )
        assert.ok(scheduled)
        assert.equal(
            scheduled.jobs.filter((job) => job.origin === 'schedule').length,
            scheduledBefore + 1,
        )
        assert.ok(
            scheduled.configuration.nextRunAt !== null &&
                scheduled.configuration.nextRunAt > Date.now(),
        )
        await probe(source, 'configure')
        const scheduledJob = scheduled.jobs.findLast((job) => job.origin === 'schedule')
        assert.ok(scheduledJob)
        await probe(source, 'verify', scheduledJob.id)
        await healthy(source)
        passed(
            'missed schedules coalesce into one catch-up and advance the next run into the future',
        )

        await command(
            [
                'docker',
                'cp',
                source + ':/var/lib/rentnerproxy/backups/artifacts/' + scheduledJob.id,
                backupPath,
            ],
            'copy fixture backup into private temporary storage',
        )
        await chmod(backupPath, 0o700)
        for (const name of [
            'app-encryption-key',
            'postgres.dump',
            'controller-state.tar',
            'crowdsec-state.tar',
            'metadata.json',
        ])
            await chmod(join(backupPath, name), 0o600)
        await verifyPublishedBackup(backupPath)
        targetCreated = true
        await command(
            [
                process.execPath,
                '--no-env-file',
                join(repositoryRoot, 'scripts/production-restore.ts'),
                '--project',
                targetProject,
                '--input',
                backupPath,
                '--confirm-replace',
            ],
            'restore managed artifact into fresh fixture target',
            600_000,
        )
        const target = await id(targetProject)
        await healthy(target)
        await command(
            ['docker', 'cp', bundleFile, target + ':' + containerProbe],
            'install private restore verification probe',
        )
        await probe(target, 'markers')
        passed(
            'existing production restore recovers the database and controller markers into a fresh healthy appliance',
        )
    } finally {
        if (helperCreated) {
            try {
                const owner = await command(
                    [
                        'docker',
                        'inspect',
                        '--format',
                        '{{index .Config.Labels "' + SMOKE_RUN_LABEL + '"}}',
                        helper,
                    ],
                    'verify owned helper cleanup',
                )
                if (owner === scope) await bestEffort(['docker', 'rm', '--force', helper])
                else cleanupFailed = true
            } catch {
                cleanupFailed = true
            }
        }
        if (sourceCreated)
            await bestEffort([...compose(sourceProject), 'down', '--volumes', '--remove-orphans'])
        if (targetCreated)
            await bestEffort([...compose(targetProject), 'down', '--volumes', '--remove-orphans'])
        if (imageBuilt) await bestEffort(['docker', 'image', 'rm', image])
        // Shared and explicitly supplied images remain caller-owned; no daemon-wide pruning occurs.
        await rm(temporary, { recursive: true, force: true })
    }
    if (cleanupFailed) throw new Error('Managed backup smoke operation failed: owned cleanup')
    return checks
}

if (import.meta.main) {
    try {
        console.log(
            'Managed backups integration: ' + (await runManagedBackupsSmoke()) + ' checks passed.',
        )
    } catch (error) {
        // Subprocess output, assertions, setup tokens, and copied encryption keys are never printed.
        const safe =
            error instanceof Error &&
            /^Managed backup (?:smoke operation failed|smoke deadline exceeded|fixture compilation failed):? [a-z -]+$/u.test(
                error.message,
            )
                ? ': ' + error.message
                : ''
        console.error('Managed backups integration failed' + safe)
        process.exitCode = 1
    }
}

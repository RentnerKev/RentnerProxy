// oxlint-disable no-await-in-loop -- Bounded smoke scenarios preserve their sequential polling.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ApplianceRestoreSafetyContext } from './Types/scenarios.types.ts'

export async function verifyApplianceRestoreSafety(context: ApplianceRestoreSafetyContext) {
    const preflightBouncerKeyDigest = await context.command([
        'docker',
        'exec',
        context.restoredId,
        'sha256sum',
        context.crowdSecStateDirectory + '/bouncer/caddy-bouncer-key',
    ])
    const preflightDatabaseMarker = await context.command([
        'docker',
        'exec',
        context.restoredId,
        'sh',
        '-c',
        `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --tuples-only --no-align --command="SELECT marker FROM appliance_compose_smoke WHERE marker = '${context.marker}';"`,
    ])
    async function assertRestorePreflightFailure(
        fixture: string,
        label: string,
        preflightEnvironment = context.scriptEnvironment,
    ): Promise<void> {
        let rejected = false
        try {
            await context.commandWithEnvironment(
                [
                    process.execPath,
                    '--no-env-file',
                    'scripts/production-restore.ts',
                    '--project',
                    context.restoreProject,
                    '--input',
                    fixture,
                    '--confirm-replace',
                ],
                preflightEnvironment,
                900_000,
            )
        } catch {
            rejected = true
        }
        assert.equal(rejected, true, label + ' unexpectedly passed restore preflight')
        assert.equal(await context.containerId(context.restoreCompose), context.restoredId)
        await context.waitForHealthy(context.restoredId)
        assert.equal(
            await context.command([
                'docker',
                'exec',
                context.restoredId,
                'sh',
                '-c',
                `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --tuples-only --no-align --command="SELECT marker FROM appliance_compose_smoke WHERE marker = '${context.marker}';"`,
            ]),
            preflightDatabaseMarker,
            label + ' changed the target database',
        )
        assert.equal(
            await context.command([
                'docker',
                'exec',
                context.restoredId,
                'sha256sum',
                '/var/lib/rentnerproxy/bootstrap/secrets-v1.json',
            ]),
            context.preflightSecretsDigest,
            label + ' changed the target secrets',
        )
        assert.equal(
            await context.command([
                'docker',
                'exec',
                context.restoredId,
                'sha256sum',
                context.crowdSecStateDirectory + '/bouncer/caddy-bouncer-key',
            ]),
            preflightBouncerKeyDigest,
            label + ' changed the target CrowdSec state',
        )
    }
    const corruptMetadataFixture = join(context.temporaryRoot, 'backup-corrupt-metadata')
    await cp(context.backupPath, corruptMetadataFixture, { recursive: true })
    await writeFile(join(corruptMetadataFixture, 'metadata.json'), '{\n', 'utf8')
    await assertRestorePreflightFailure(corruptMetadataFixture, 'corrupt metadata')

    const corruptArchiveFixture = join(context.temporaryRoot, 'backup-corrupt-crowdsec-archive')
    await cp(context.backupPath, corruptArchiveFixture, { recursive: true })
    const corruptCrowdSecArchive = await readFile(join(corruptArchiveFixture, 'crowdsec-state.tar'))
    const lastArchiveByte = corruptCrowdSecArchive[corruptCrowdSecArchive.length - 1]
    if (lastArchiveByte === undefined) throw new Error('CrowdSec archive is empty.')
    corruptCrowdSecArchive[corruptCrowdSecArchive.length - 1] = lastArchiveByte ^ 1
    await writeFile(join(corruptArchiveFixture, 'crowdsec-state.tar'), corruptCrowdSecArchive)
    await assertRestorePreflightFailure(corruptArchiveFixture, 'corrupt CrowdSec archive')

    const missingArchiveFixture = join(context.temporaryRoot, 'backup-missing-crowdsec-archive')
    await cp(context.backupPath, missingArchiveFixture, { recursive: true })
    await rm(join(missingArchiveFixture, 'crowdsec-state.tar'))
    await assertRestorePreflightFailure(missingArchiveFixture, 'missing CrowdSec archive')

    const wrongKeyFixture = join(context.temporaryRoot, 'backup-wrong-application-key')
    await cp(context.backupPath, wrongKeyFixture, { recursive: true })
    const wrongApplicationKey = randomBytes(32).toString('base64')
    const wrongApplicationKeyBytes = Buffer.from(wrongApplicationKey)
    await writeFile(join(wrongKeyFixture, 'app-encryption-key'), wrongApplicationKeyBytes)
    const wrongKeyMetadataPath = join(wrongKeyFixture, 'metadata.json')
    const wrongKeyMetadata = JSON.parse(
        await readFile(wrongKeyMetadataPath, 'utf8'),
    ) as typeof context.backupMetadata & {
        applicationEncryptionKey: { bytes: number; file: string; sha256: string }
    }
    wrongKeyMetadata.applicationEncryptionKey = {
        bytes: wrongApplicationKeyBytes.byteLength,
        file: 'app-encryption-key',
        sha256: context.digest(wrongApplicationKeyBytes),
    }
    await writeFile(wrongKeyMetadataPath, JSON.stringify(wrongKeyMetadata, null, 2) + '\n')
    await assertRestorePreflightFailure(wrongKeyFixture, 'wrong application encryption key')
    for (const version of [1, 2] as const) {
        const unsupportedFixture = join(context.temporaryRoot, 'backup-unsupported-v' + version)
        await cp(context.backupPath, unsupportedFixture, { recursive: true })
        const unsupportedMetadataPath = join(unsupportedFixture, 'metadata.json')
        const unsupportedMetadata = JSON.parse(
            await readFile(unsupportedMetadataPath, 'utf8'),
        ) as typeof context.backupMetadata
        unsupportedMetadata.version = version
        await writeFile(
            unsupportedMetadataPath,
            JSON.stringify(unsupportedMetadata, null, 2) + '\n',
        )
        await assertRestorePreflightFailure(
            unsupportedFixture,
            'unsupported synthetic v' + version + ' metadata',
        )
    }
    context.passed(
        'invalid backups leave the running target database, secrets and CrowdSec state untouched',
    )

    const changedPublicOrigin = 'https://changed.appliance-smoke.invalid'
    const changedTrustedProxyCidrs = '192.0.2.0/24'
    const changedDeploymentEnvironment: NodeJS.ProcessEnv = {
        ...context.scriptEnvironment,
        PUBLIC_ORIGIN: changedPublicOrigin,
        PROXY_TRUSTED_PROXY_CIDRS: changedTrustedProxyCidrs,
    }
    await assertRestorePreflightFailure(
        context.backupPath,
        'deployment mismatch',
        changedDeploymentEnvironment,
    )
    context.passed('restore rejects a deployment mismatch before stopping or replacing the target')
    await context.command(
        [...context.restoreCompose, 'stop', '--timeout', '30', 'rentnerproxy'],
        180_000,
    )
    await context.commandWithEnvironment(
        [
            process.execPath,
            '--no-env-file',
            'scripts/production-restore.ts',
            '--project',
            context.deploymentChangeProject,
            '--input',
            context.backupPath,
            '--confirm-replace',
            '--allow-deployment-change',
        ],
        changedDeploymentEnvironment,
        900_000,
    )
    const deploymentChangeId = await context.containerId(context.deploymentChangeCompose)
    await context.waitForHealthy(deploymentChangeId)
    const deploymentChangeRuntime = JSON.parse(
        await context.inspect(deploymentChangeId, '{{json .Config.Env}}'),
    ) as string[]
    assert.ok(deploymentChangeRuntime.includes('PUBLIC_ORIGIN=' + changedPublicOrigin))
    assert.ok(
        deploymentChangeRuntime.includes('PROXY_TRUSTED_PROXY_CIDRS=' + changedTrustedProxyCidrs),
    )
    await context.assertRealTraffic(
        deploymentChangeId,
        'an explicitly allowed deployment change preserves real traffic',
    )
    await context.command(
        [...context.deploymentChangeCompose, 'down', '--volumes', '--remove-orphans'],
        180_000,
    )
    context.passed(
        'an explicit deployment-change option permits restoring to the new deployment settings',
    )
    await context.command([...context.restoreCompose, 'start', 'rentnerproxy'], 180_000)
    await context.waitForHealthy(context.restoredId)

    await context.assertRealTraffic(
        context.restoredId,
        'v4 restore heals Caddy from desired DB and preserves HTTP/HTTPS traffic',
    )
    await context.assertPublishedQuic()
    context.passed(
        'verified HTTP/3 and deployment origin survive restore with trusted proxy configuration',
    )
    await context.command([
        'docker',
        'exec',
        context.restoredId,
        'rm',
        '-f',
        '/var/lib/rentnerproxy/bootstrap/secrets-v1.json',
    ])
    await context.command([...context.restoreCompose, 'restart', 'rentnerproxy'])
    await context.waitFor(
        async () => !(await context.containerHealth(context.restoredId)).includes('|healthy|'),
        'fail-closed startup after bootstrap state removal',
        150_000,
    )
    context.passed('removing bootstrap state while PostgreSQL data remains fails closed')
    await context.commandFails(
        [...context.restoreCompose, 'down', '--volumes', '--remove-orphans'],
        180_000,
    )

    if (process.platform === 'linux') {
        const dockerExecutable = await context.command(['which', 'docker'])
        const dockerShimDirectory = join(context.temporaryRoot, 'restore-docker-shim')
        await mkdir(dockerShimDirectory, { recursive: true })
        const dockerShim = join(dockerShimDirectory, 'docker')
        await writeFile(
            dockerShim,
            `#!/bin/sh\ncase " $* " in\n  *"RENTNERPROXY_RESTORE_PHASE=database"*)\n    "${dockerExecutable}" "$@"\n    status=$?\n    if [ "$status" -eq 0 ]; then exit 143; fi\n    exit "$status"\n    ;;\nesac\nexec "${dockerExecutable}" "$@"\n`,
            { mode: 0o700 },
        )
        const interruptedEnvironment: NodeJS.ProcessEnv = {
            ...context.scriptEnvironment,
            PATH: dockerShimDirectory + ':' + (context.scriptEnvironment.PATH ?? ''),
        }
        let interrupted = false
        try {
            await context.commandWithEnvironment(
                [
                    process.execPath,
                    '--no-env-file',
                    'scripts/production-restore.ts',
                    '--project',
                    context.restoreProject,
                    '--input',
                    context.backupPath,
                    '--confirm-replace',
                ],
                interruptedEnvironment,
                900_000,
            )
        } catch {
            interrupted = true
        }
        assert.equal(interrupted, true, 'restore phase shim did not interrupt after PostgreSQL')
        assert.equal(
            await context.command([
                ...context.restoreCompose,
                'ps',
                '--status',
                'running',
                '--quiet',
            ]),
            '',
        )
        const restoreJournalPath = '/var/lib/rentnerproxy/bootstrap/production-restore-v1.json'
        const restoreJournal = JSON.parse(
            await context.command([
                ...context.restoreCompose,
                'run',
                '--no-TTY',
                '--rm',
                '--no-deps',
                '--entrypoint',
                'cat',
                'rentnerproxy',
                restoreJournalPath,
            ]),
        ) as { backupId?: string; version?: number }
        assert.deepEqual(restoreJournal, {
            version: 1,
            backupId: context.digest(await readFile(join(context.backupPath, 'metadata.json'))),
        })
        let resumeRequired = false
        try {
            await context.commandWithEnvironment(
                [
                    process.execPath,
                    '--no-env-file',
                    'scripts/production-restore.ts',
                    '--project',
                    context.restoreProject,
                    '--input',
                    context.backupPath,
                    '--confirm-replace',
                ],
                context.scriptEnvironment,
                900_000,
            )
        } catch {
            resumeRequired = true
        }
        assert.equal(resumeRequired, true, 'restore without --resume ignored the pending journal')
        assert.deepEqual(
            JSON.parse(
                await context.command([
                    ...context.restoreCompose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint',
                    'cat',
                    'rentnerproxy',
                    restoreJournalPath,
                ]),
            ),
            restoreJournal,
        )
        await context.commandWithEnvironment(
            [
                process.execPath,
                '--no-env-file',
                'scripts/production-restore.ts',
                '--project',
                context.restoreProject,
                '--input',
                context.backupPath,
                '--confirm-replace',
                '--resume',
            ],
            context.scriptEnvironment,
            900_000,
        )
        const resumedRestoreId = await context.containerId(context.restoreCompose)
        await context.waitForHealthy(resumedRestoreId)
        await context.waitForCrowdSec(
            resumedRestoreId,
            (status) =>
                status.mode === 'managed' &&
                status.state === 'connected' &&
                status.managedEngine === 'ready',
            'resumed managed CrowdSec restore',
        )
        const resumedDecisionList = await context.command([
            'docker',
            'exec',
            resumedRestoreId,
            'gosu',
            'crowdsec',
            'cscli',
            '-c',
            '/usr/share/rentnerproxy/crowdsec/config.yaml',
            'decisions',
            'list',
            '--ip',
            context.crowdSecBackupDecision,
            '-o',
            'json',
        ])
        assert.match(resumedDecisionList, new RegExp(context.crowdSecBackupDecision, 'u'))
        await context.assertRealTraffic(
            resumedRestoreId,
            'an interrupted restore resumes from its journal and restores CrowdSec enforcement',
        )
        await context.command([
            'docker',
            'exec',
            resumedRestoreId,
            'test',
            '!',
            '-e',
            restoreJournalPath,
        ])
        context.passed(
            'database-phase interruption requires and completes same-backup restore resume',
        )
    }

    await context.command(
        [...context.restoreCompose, 'down', '--volumes', '--remove-orphans'],
        180_000,
    )
    return {}
}

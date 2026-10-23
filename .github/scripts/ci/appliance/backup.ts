// oxlint-disable no-await-in-loop -- Bounded smoke scenarios preserve their sequential polling.
import assert from 'node:assert/strict'
import { verifyApplianceStartup } from '../appliance-startup-smoke.ts'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { seedBackupState, assertBackupState } from '../fixtures/backup-state.ts'
import {
    seedPersistenceFixture,
    readPersistenceSnapshot,
    assertPersistenceRequestDecrypts,
} from '../fixtures/persistence/state.ts'
import type { ApplianceBackupContext } from './Types/scenarios.types.ts'

export async function verifyApplianceBackup(context: ApplianceBackupContext) {
    context.recreatedId = await verifyApplianceStartup({
        temporaryRoot: context.temporaryRoot,
        entrypointFile: join(context.repositoryRoot, 'docker/production/entrypoint.sh'),
        compose: context.compose,
        httpPort: context.httpPort,
        httpsPort: context.httpsPort,
        managementPort: context.managementPort,
        hostDomain: context.hostDomain,
        trafficMarker: context.trafficMarker,
        ca: await readFile(context.http3CaFile, 'utf8'),
        command: context.command,
        containerId: context.containerId,
        waitForHealthy: context.waitForHealthy,
        assertSecurityReady: async (startingId) => {
            const status = await context.waitForCrowdSec(
                startingId,
                (current) =>
                    current.mode === 'managed' &&
                    current.state === 'connected' &&
                    current.managedEngine === 'ready' &&
                    current.enforcementActive,
                'managed CrowdSec before database/cache readiness',
            )
            assert.equal(status.credentialConfigured, false)
            assert.equal(status.failureBehavior, 'fail_open')
            await context.command([
                'docker',
                'exec',
                startingId,
                'test',
                '-s',
                '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
            ])
        },
        passed: context.passed,
    })

    const crowdSecBackupDecision = '192.0.2.71'
    await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'gosu',
        'crowdsec',
        'cscli',
        '-c',
        '/usr/share/rentnerproxy/crowdsec/config.yaml',
        'decisions',
        'add',
        '--ip',
        crowdSecBackupDecision,
        '--duration',
        '24h',
        '--reason',
        'rentnerproxy-backup-restore-smoke',
    ])
    const crowdSecBackupDecisionList = await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'gosu',
        'crowdsec',
        'cscli',
        '-c',
        '/usr/share/rentnerproxy/crowdsec/config.yaml',
        'decisions',
        'list',
        '--ip',
        crowdSecBackupDecision,
        '-o',
        'json',
    ])
    assert.match(crowdSecBackupDecisionList, new RegExp(crowdSecBackupDecision, 'u'))
    context.passed('managed CrowdSec has a durable reserved-IP decision before backup')

    const crowdSecStateDirectory = '/var/lib/rentnerproxy/crowdsec'
    const communityCredentialFixture =
        'url: https://fixture.crowdsec.invalid\nlogin: smoke-' +
        context.runId +
        '\npassword: fixture-only\n'
    const consoleCredentialFixture =
        'url: https://console.crowdsec.invalid\ntoken: fixture-only-' + context.runId + '\n'
    for (const [name, contents] of [
        ['online_api_credentials.yaml', communityCredentialFixture],
        ['console.yaml', consoleCredentialFixture],
    ] as const) {
        const encoded = Buffer.from(contents).toString('base64')
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'sh',
            '-c',
            `printf '%s' '${encoded}' | base64 -d > '${crowdSecStateDirectory}/credentials/${name}' && chown crowdsec:crowdsec '${crowdSecStateDirectory}/credentials/${name}' && chmod 0600 '${crowdSecStateDirectory}/credentials/${name}'`,
        ])
    }
    const durableCrowdSecFileDigests = new Map<string, string>()
    for (const name of [
        'credentials/local_api_credentials.yaml',
        'credentials/online_api_credentials.yaml',
        'credentials/console.yaml',
        'bouncer/caddy-bouncer-key',
    ]) {
        const path = crowdSecStateDirectory + '/' + name
        durableCrowdSecFileDigests.set(
            name,
            await context.command(['docker', 'exec', context.recreatedId, 'sha256sum', path]),
        )
    }
    await context.assertRealTraffic(
        context.recreatedId,
        'managed CrowdSec remains active while the persistent decision is prepared for backup',
    )

    const proxyBackupMarker = '/var/lib/rentnerproxy/proxy/appliance-backup-marker'
    await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'test',
        '-s',
        '/var/lib/rentnerproxy/proxy/logs/access.log',
    ])
    await context.command([
        'docker',
        'exec',
        '--user',
        '10001:10001',
        context.recreatedId,
        'sh',
        '-c',
        `printf %s ${context.marker} > ${proxyBackupMarker}`,
    ])
    const proxyBackupMarkerDigest = await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'sha256sum',
        proxyBackupMarker,
    ])
    const persistenceFixture = await seedPersistenceFixture({
        command: context.command,
        containerId: context.recreatedId,
        runId: context.runId,
    })
    const persistenceSnapshot = await readPersistenceSnapshot({
        command: context.command,
        containerId: context.recreatedId,
        fixture: persistenceFixture,
    })
    await assertPersistenceRequestDecrypts({
        command: context.command,
        containerId: context.recreatedId,
        fixture: persistenceFixture,
    })
    context.passed(
        'durable binding jobs, renewal retry metadata and event receipts are present before backup',
    )
    const savedExternalApiKey = 'appliance-smoke-crowdsec-key-' + context.runId
    const encryptedSavedExternalApiKey = context.encryptCrowdSecApiKey(
        savedExternalApiKey,
        context.generatedSecrets.appEncryptionKey!,
    )
    const managedWithSavedExternalConfig = {
        version: 1,
        mode: 'managed',
        communityEnabled: false,
        external: {
            apiUrl: 'https://saved-external.crowdsec.invalid/',
            apiKey: encryptedSavedExternalApiKey,
        },
    }
    const savedExternalConfigSql = JSON.stringify(managedWithSavedExternalConfig)
    await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'gosu',
        'postgres',
        'psql',
        '--no-psqlrc',
        '--no-password',
        '--host=/var/run/postgresql',
        '--username=postgres',
        '--dbname=rentnerproxy',
        '--command',
        `INSERT INTO rentnerproxy.system_settings (key, value) VALUES ('crowdsec_configuration_v1', '${savedExternalConfigSql}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;`,
    ])
    const savedExternalConfig = JSON.parse(
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'gosu',
            'postgres',
            'psql',
            '--no-psqlrc',
            '--no-password',
            '--tuples-only',
            '--no-align',
            '--host=/var/run/postgresql',
            '--username=postgres',
            '--dbname=rentnerproxy',
            '--command',
            "SELECT value::text FROM rentnerproxy.system_settings WHERE key='crowdsec_configuration_v1';",
        ]),
    ) as typeof managedWithSavedExternalConfig
    assert.equal(
        context.decryptCrowdSecApiKey(
            savedExternalConfig.external.apiKey,
            context.generatedSecrets.appEncryptionKey!,
        ),
        savedExternalApiKey,
    )
    const betaBackupState = await seedBackupState({
        command: context.command,
        containerId: context.recreatedId,
        runId: context.runId,
    })
    await assertBackupState({
        command: context.command,
        containerId: context.recreatedId,
        fixture: betaBackupState,
    })
    // Retain the original live-backup contract: quiesce a running appliance and restart it.
    const runningBackupRoot = join(context.temporaryRoot, 'running-source-backup')
    await context.commandWithEnvironment(
        [
            process.execPath,
            '--no-env-file',
            'scripts/production-backup.ts',
            '--project',
            context.project,
            '--output',
            runningBackupRoot,
        ],
        context.scriptEnvironment,
        900_000,
    )
    await context.waitForHealthy(await context.containerId(context.compose))
    assert.equal((await readdir(runningBackupRoot)).length, 1)
    await context.assertRealTraffic(
        context.recreatedId,
        'a running-source production backup quiesces and restarts without losing existing traffic',
    )
    context.passed(
        'production backup quiesces a running source and restores its healthy serving state',
    )
    const beta2Automation = context.startBeta2Automation()
    await beta2Automation.seedDatabase(
        context.command,
        context.recreatedId,
        persistenceFixture.ownerUserId,
        context.generatedSecrets.appEncryptionKey!,
    )
    await context.command([...context.compose, 'stop', '--timeout', '30', 'rentnerproxy'], 180_000)
    // DNS tokens are seeded offline: production DNS providers remain pinned and are never contacted.
    await beta2Automation.seedStoppedController(context.command, context.compose)
    const backupRoot = join(context.temporaryRoot, 'backups')
    await context.commandWithEnvironment(
        [
            process.execPath,
            '--no-env-file',
            'scripts/production-backup.ts',
            '--project',
            context.project,
            '--output',
            backupRoot,
        ],
        context.scriptEnvironment,
        900_000,
    )
    // Keep the completed artifact active and unpaused while preventing any real provider call
    // from the source's explicit restart. No controller runs between offline seeding and this fence.
    await beta2Automation.pauseStoppedSource(context.command, context.compose)
    await context.command([...context.compose, 'start', 'rentnerproxy'], 180_000)
    await context.waitForHealthy(await context.containerId(context.compose))
    const backupEntries = await readdir(backupRoot)
    assert.equal(backupEntries.length, 1)
    const backupPath = join(backupRoot, backupEntries[0]!)
    const archivedStateFiles = await context.command([
        'docker',
        'run',
        '--rm',
        '--entrypoint',
        'tar',
        '--volume',
        backupPath + ':/backup:ro',
        context.imageTag,
        '--list',
        '--file=/backup/controller-state.tar',
    ])
    assert.doesNotMatch(archivedStateFiles, /(?:^|\n)\.\/logs(?:\/|$)/u)
    assert.doesNotMatch(
        archivedStateFiles,
        /(?:^|\n)\.\/(?:ddns|docker-discovery)-restore-paused(?:\s|$)/u,
    )
    context.passed('production backups exclude the request logs from real proxy traffic')
    const archivedCrowdSecFiles = await context.command([
        'docker',
        'run',
        '--rm',
        '--entrypoint',
        'tar',
        '--volume',
        backupPath + ':/backup:ro',
        context.imageTag,
        '--list',
        '--file=/backup/crowdsec-state.tar',
    ])
    for (const entry of [
        'data/crowdsec.db',
        'credentials/local_api_credentials.yaml',
        'credentials/online_api_credentials.yaml',
        'credentials/console.yaml',
        'bouncer/caddy-bouncer-key',
    ]) {
        assert.ok(archivedCrowdSecFiles.includes(entry), 'CrowdSec archive omitted ' + entry)
    }
    assert.doesNotMatch(archivedCrowdSecFiles, /(?:^|\n).*\.db-shm\s*$/u)
    context.passed(
        'production backups archive CrowdSec database, registrations and managed bouncer key',
    )
    return {
        crowdSecBackupDecision,
        crowdSecStateDirectory,
        durableCrowdSecFileDigests,
        proxyBackupMarker,
        proxyBackupMarkerDigest,
        persistenceFixture,
        persistenceSnapshot,
        savedExternalApiKey,
        savedExternalConfig,
        betaBackupState,
        beta2AutomationFixture: beta2Automation,
        backupPath,
    }
}

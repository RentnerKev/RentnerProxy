// oxlint-disable no-await-in-loop -- Bounded smoke scenarios preserve their sequential polling.
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { assertBackupState } from '../fixtures/backup-state.ts'
import {
    assertPersistenceFixture,
    assertPersistenceRequestDecrypts,
} from '../fixtures/persistence/state.ts'
import type { ApplianceRestoreContext } from './Types/scenarios.types.ts'

export async function verifyApplianceRestore(context: ApplianceRestoreContext) {
    if (process.platform !== 'win32') {
        assert.equal((await stat(context.backupPath)).mode & 0o777, 0o700)
        for (const name of [
            'app-encryption-key',
            'controller-state.tar',
            'crowdsec-state.tar',
            'metadata.json',
            'postgres.dump',
        ]) {
            const file = await stat(join(context.backupPath, name))
            assert.equal(file.uid, process.getuid?.())
            assert.equal(file.mode & 0o777, 0o600)
        }
    }
    const backupMetadata = JSON.parse(
        await readFile(join(context.backupPath, 'metadata.json'), 'utf8'),
    ) as {
        applicationEncryptionKey?: { file?: string }
        controllerState?: { archive?: string }
        crowdSecState?: { archive?: string; bytes?: number; sha256?: string }
        deployment?: { publicOrigin?: string; trustedProxyCidrs?: string }
        redis?: string
        version?: number
    }
    assert.equal(backupMetadata.version, 4)
    assert.equal(backupMetadata.redis, 'excluded')
    assert.equal(backupMetadata.applicationEncryptionKey?.file, 'app-encryption-key')
    assert.equal(backupMetadata.controllerState?.archive, 'controller-state.tar')
    assert.equal(backupMetadata.crowdSecState?.archive, 'crowdsec-state.tar')
    assert.equal(
        backupMetadata.crowdSecState?.bytes,
        (await stat(join(context.backupPath, 'crowdsec-state.tar'))).size,
    )
    assert.equal(
        backupMetadata.crowdSecState?.sha256,
        context.digest(await readFile(join(context.backupPath, 'crowdsec-state.tar'))),
    )
    assert.deepEqual(backupMetadata.deployment, {
        publicOrigin: context.publicOrigin,
        trustedProxyCidrs: context.trustedProxyCidrs,
    })
    assert.equal(
        (await readFile(join(context.backupPath, 'app-encryption-key'), 'utf8')).trim(),
        context.generatedSecrets.appEncryptionKey,
    )

    await context.command([...context.compose, 'down', '--remove-orphans'], 180_000)
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
    const restoredId = await context.containerId(context.restoreCompose)
    await context.waitForHealthy(restoredId)
    const restoredCrowdSec = await context.waitForCrowdSec(
        restoredId,
        (status) =>
            status.mode === 'managed' &&
            status.state === 'connected' &&
            status.managedEngine === 'ready',
        'restored managed CrowdSec state',
    )
    assert.equal(restoredCrowdSec.enforcementActive, true)
    const restoredDecisionList = await context.command([
        'docker',
        'exec',
        restoredId,
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
    assert.match(restoredDecisionList, new RegExp(context.crowdSecBackupDecision, 'u'))
    const restoredBouncers = await context.command([
        'docker',
        'exec',
        restoredId,
        'gosu',
        'crowdsec',
        'cscli',
        '-c',
        '/usr/share/rentnerproxy/crowdsec/config.yaml',
        'bouncers',
        'list',
    ])
    assert.match(restoredBouncers, /rentnerproxy-caddy/u)
    await context.command([
        'docker',
        'exec',
        restoredId,
        'sh',
        '-c',
        'key=$(cat /var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key); status=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out "%{http_code}" --header "X-Api-Key: $key" "http://127.0.0.1:18080/v1/decisions/stream?startup=true"); test "$status" = 200',
    ])
    for (const [name, expected] of [
        ['data', '700:10003:10003'],
        ['credentials', '700:10003:10003'],
        ['data/crowdsec.db', '640:10003:10003'],
        ['credentials/local_api_credentials.yaml', '600:10003:10003'],
        ['credentials/online_api_credentials.yaml', '600:10003:10003'],
        ['credentials/console.yaml', '600:10003:10003'],
        ['bouncer', '710:0:10001'],
        ['bouncer/caddy-bouncer-key', '440:0:10001'],
    ] as const) {
        assert.equal(
            await context.command([
                'docker',
                'exec',
                restoredId,
                'stat',
                '-c',
                '%a:%u:%g',
                context.crowdSecStateDirectory + '/' + name,
            ]),
            expected,
            'unexpected restored CrowdSec ownership/mode: ' + name,
        )
    }
    for (const name of [
        'credentials/local_api_credentials.yaml',
        'credentials/online_api_credentials.yaml',
        'credentials/console.yaml',
    ]) {
        assert.equal(
            await context.command([
                'docker',
                'exec',
                restoredId,
                'sha256sum',
                context.crowdSecStateDirectory + '/' + name,
            ]),
            context.durableCrowdSecFileDigests.get(name),
            'restored CrowdSec credential changed: ' + name,
        )
    }
    const restoredBouncerKey = await context.command([
        'docker',
        'exec',
        restoredId,
        'cat',
        context.crowdSecStateDirectory + '/bouncer/caddy-bouncer-key',
    ])
    assert.match(restoredBouncerKey, /^[a-f0-9]{64}$/u)
    await context.assertRealTraffic(
        restoredId,
        'managed CrowdSec decision, bouncer authorization and proxy traffic survive restore',
    )
    context.passed(
        'backup restores CrowdSec decisions, credentials and a ready authorized Caddy bouncer',
    )
    await assertBackupState({
        command: context.command,
        containerId: restoredId,
        fixture: context.betaBackupState,
    })
    context.passed(
        'backup restores saved Forward Auth configuration and exact NPM importer history',
    )
    const restoredEnvironment = JSON.parse(
        await context.inspect(restoredId, '{{json .Config.Env}}'),
    ) as string[]
    assert.ok(restoredEnvironment.includes('RENTNERPROXY_PUBLIC_ORIGIN=' + context.publicOrigin))
    assert.ok(
        restoredEnvironment.includes(
            'RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS=' + context.trustedProxyCidrs,
        ),
    )
    const restoredSavedExternalConfig = JSON.parse(
        await context.command([
            'docker',
            'exec',
            restoredId,
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
    ) as typeof context.savedExternalConfig
    assert.deepEqual(
        restoredSavedExternalConfig.external.apiKey,
        context.savedExternalConfig.external.apiKey,
    )
    assert.equal(
        context.decryptCrowdSecApiKey(
            restoredSavedExternalConfig.external.apiKey,
            context.generatedSecrets.appEncryptionKey!,
        ),
        context.savedExternalApiKey,
    )
    await assertPersistenceFixture({
        command: context.command,
        containerId: restoredId,
        fixture: context.persistenceFixture,
        expected: context.persistenceSnapshot,
    })
    await assertPersistenceRequestDecrypts({
        command: context.command,
        containerId: restoredId,
        fixture: context.persistenceFixture,
    })
    context.passed(
        'backup restores exact binding jobs, retry states and event journal data with decryptable requests',
    )
    const disasterRestoreSecrets = JSON.parse(
        await context.command([
            'docker',
            'exec',
            restoredId,
            'bun',
            '-e',
            'const state = await Bun.file("/var/lib/rentnerproxy/bootstrap/secrets-v1.json").json(); process.stdout.write(JSON.stringify(state));',
        ]),
    ) as Record<string, string>
    assert.equal(disasterRestoreSecrets.appEncryptionKey, context.generatedSecrets.appEncryptionKey)
    assert.match(disasterRestoreSecrets.postgresPassword!, /^[a-f0-9]{64}$/u)
    assert.match(disasterRestoreSecrets.controllerToken!, /^[a-f0-9]{64}$/u)
    assert.equal(
        disasterRestoreSecrets.databaseUrl,
        `postgresql://rentnerproxy:${disasterRestoreSecrets.postgresPassword}@127.0.0.1:5432/rentnerproxy`,
    )
    assert.notEqual(
        disasterRestoreSecrets.postgresPassword,
        context.generatedSecrets.postgresPassword,
    )
    assert.notEqual(
        disasterRestoreSecrets.controllerToken,
        context.generatedSecrets.controllerToken,
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            restoredId,
            'sh',
            '-c',
            `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --tuples-only --no-align --command="SELECT marker FROM appliance_compose_smoke WHERE marker = '${context.marker}';"`,
        ]),
        context.marker,
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            restoredId,
            'sha256sum',
            context.proxyBackupMarker,
        ]),
        context.proxyBackupMarkerDigest,
    )
    context.passed(
        'backup restores PostgreSQL, controller state, and application identity to a fresh appliance',
    )
    const preflightSecretsDigest = await context.command([
        'docker',
        'exec',
        restoredId,
        'sha256sum',
        '/var/lib/rentnerproxy/bootstrap/secrets-v1.json',
    ])
    return {
        backupMetadata,
        restoredId,
        preflightSecretsDigest,
    }
}

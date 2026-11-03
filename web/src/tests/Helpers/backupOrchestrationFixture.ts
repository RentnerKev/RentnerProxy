// oxlint-disable no-await-in-loop -- A private PostgreSQL lifecycle and its migrations must run in order.
import { createCipheriv, createHash, randomUUID } from 'node:crypto'
import {
    chmod,
    chown,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createManagedBackupEngine } from '../../../../scripts/backup/managed-jobs.ts'
import { runMaintenanceProcess } from '../../../../scripts/backup/maintenance-process.ts'
import { verifyPublishedBackup } from '../../../../scripts/backup/publication.ts'
import { copyCoverageFixtureModules } from './coverageFixture.ts'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const actorId = '00000000-0000-4000-8000-000000000001'
const oldSession = '00000000-0000-4000-8000-000000000002'
const liveSession = '00000000-0000-4000-8000-000000000003'

async function command(args: string[], input?: string) {
    const result = await runMaintenanceProcess(args, {
        cwd: root,
        timeoutMs: 25_000,
        maximumOutputBytes: 1_048_576,
        ...(input === undefined ? {} : { input: Buffer.from(input) }),
    })
    if (result.failed || !result.stopped)
        throw new Error(`Fixture command failed (${args[0]}): ${result.stderr.slice(-800)}`)
    return Buffer.from(result.stdout).toString('utf8').trim()
}

export async function runBackupOrchestrationFixture(scenario: string) {
    const prefix = join(tmpdir(), 'rentnerproxy-orchestration-')
    const directory = await mkdtemp(prefix)
    if (!resolve(directory).startsWith(resolve(prefix)))
        throw new Error('Unsafe fixture cleanup path.')
    await chmod(directory, 0o711)
    const code = join(directory, 'code')
    const app = join(directory, 'app')
    const socket = join(directory, 'socket')
    const cluster = join(directory, 'cluster')
    const control = join(directory, 'runtime/backups')
    let postgres: ReturnType<typeof Bun.spawn> | undefined
    let runningAgent:
        | Awaited<
              ReturnType<
                  typeof import('../../../../docker/production/backups/agent.ts').startBackupAgent
              >
          >
        | undefined
    let supervisorIdentityVerified = false
    const psql = [
        'gosu',
        'postgres',
        'psql',
        '--host=' + socket,
        '--no-psqlrc',
        '--no-password',
        '--username=rentnerproxy',
        '--dbname=rentnerproxy',
        '--set=ON_ERROR_STOP=1',
        '--tuples-only',
        '--no-align',
    ]
    try {
        await copyCoverageFixtureModules(
            code,
            [
                'docker/production/backups/export.ts',
                'docker/production/backups/restore.ts',
                'docker/production/backups/storage.ts',
                'docker/production/backups/agent.ts',
                'docker/production/backups/download.ts',
                'docker/production/backups/off-host.ts',
                'docker/web/bootstrap-secrets.ts',
                'docker/web/validate-backup.ts',
                'scripts/production-restore.ts',
            ],
            {
                '/var/lib/rentnerproxy': app,
                '/run/rentnerproxy': join(directory, 'runtime'),
                '/var/run/postgresql': socket,
                '/usr/share/rentnerproxy': join(directory, 'source'),
                '/opt/rentnerproxy/web/backup-export.js': join(
                    code,
                    'docker/production/backups/export.ts',
                ),
                '/opt/rentnerproxy/web/web/drizzle': join(root, 'web/drizzle'),
                '/tmp/rentnerproxy-validate-': join(directory, 'validation-'),
                '/tmp/rentnerproxy-restore.': join(directory, 'rendered-restore.'),
            },
        )
        const storage = (await import(
            pathToFileURL(join(code, 'docker/production/backups/storage.ts')).href
        )) as typeof import('../../../../docker/production/backups/storage.ts')
        const exporter = (await import(
            pathToFileURL(join(code, 'docker/production/backups/export.ts')).href
        )) as typeof import('../../../../docker/production/backups/export.ts')
        const restore = (await import(
            pathToFileURL(join(code, 'docker/production/backups/restore.ts')).href
        )) as typeof import('../../../../docker/production/backups/restore.ts')
        const bootstrap = (await import(
            pathToFileURL(join(code, 'docker/web/bootstrap-secrets.ts')).href
        )) as typeof import('../../../../docker/web/bootstrap-secrets.ts')
        await Promise.all([
            mkdir(cluster),
            mkdir(socket),
            mkdir(control, { recursive: true }),
            mkdir(join(app, 'proxy/certificates'), { recursive: true }),
            mkdir(join(app, 'crowdsec/bouncer'), { recursive: true }),
            mkdir(storage.artifactsRoot, { recursive: true, mode: 0o700 }),
        ])
        await chown(control, 0, 10001)
        await chmod(control, 0o750)
        await chown(cluster, 999, 999)
        await chown(socket, 999, 999)
        await command([
            'gosu',
            'postgres',
            'initdb',
            '--auth=trust',
            '--username=postgres',
            '-D',
            cluster,
        ])
        postgres = Bun.spawn(
            [
                'gosu',
                'postgres',
                'postgres',
                '-D',
                cluster,
                '-c',
                'listen_addresses=',
                '-c',
                'unix_socket_directories=' + socket,
            ],
            { stdout: 'ignore', stderr: 'ignore' },
        )
        const postgresDeadline = Date.now() + 10_000
        while (true) {
            const probe = Bun.spawn(
                ['gosu', 'postgres', 'pg_isready', '--host=' + socket, '--username=postgres'],
                { stdout: 'ignore', stderr: 'ignore' },
            )
            if ((await probe.exited) === 0) break
            if (Date.now() > postgresDeadline)
                throw new Error('Private PostgreSQL fixture startup timed out.')
            await Bun.sleep(50)
        }
        await command([
            'gosu',
            'postgres',
            'psql',
            '--host=' + socket,
            '--username=postgres',
            '--dbname=postgres',
            '--set=ON_ERROR_STOP=1',
            '-c',
            'CREATE ROLE rentnerproxy LOGIN;',
        ])
        await command([
            'gosu',
            'postgres',
            'createdb',
            '--host=' + socket,
            '--username=postgres',
            '--owner=rentnerproxy',
            'rentnerproxy',
        ])
        const journal = JSON.parse(
            await readFile(join(root, 'web/drizzle/meta/_journal.json'), 'utf8'),
        ) as { entries: { tag: string; when: number }[] }
        const migrationBodies = await Promise.all(
            journal.entries.map((entry) =>
                readFile(join(root, 'web/drizzle', entry.tag + '.sql'), 'utf8'),
            ),
        )
        const records = journal.entries
            .map(
                (entry, index) =>
                    `('${createHash('sha256').update(migrationBodies[index]!).digest('hex')}',${entry.when})`,
            )
            .join(',')
        await command(
            psql,
            'CREATE SCHEMA rentnerproxy; CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint);\n' +
                migrationBodies.join('\n') +
                `\nINSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ${records};`,
        )
        await command(
            psql,
            `INSERT INTO rentnerproxy.users(id,display_name,email,status) VALUES ('${actorId}','Fixture','fixture@example.test','active'); INSERT INTO rentnerproxy.sessions(id,user_id,token_hash,expires_at,oidc_proof) VALUES ('${oldSession}','${actorId}','${'a'.repeat(64)}','2099-01-01',NULL); INSERT INTO rentnerproxy.system_settings(key,value) VALUES ('orchestration_fixture','1');`,
        )
        await command([
            process.execPath,
            '--no-env-file',
            join(code, 'docker/web/bootstrap-secrets.ts'),
            'initialize',
        ])
        const key = Buffer.from(
            (await readFile(join(directory, 'runtime/app-key/value'), 'utf8')).trim(),
            'base64',
        )
        const certificateId = '0198d98a-0000-7000-8000-000000000881'
        const nonce = Buffer.alloc(12, 8)
        const cipher = createCipheriv('aes-256-gcm', key, nonce)
        cipher.setAAD(Buffer.from(certificateId))
        const ciphertext = Buffer.concat([
            cipher.update('synthetic private provider'),
            cipher.final(),
            cipher.getAuthTag(),
        ])
        await writeFile(
            join(app, 'proxy/certificates/certificate-metadata.json'),
            JSON.stringify({
                id: certificateId,
                acme: {
                    dnsProvider: { version: 1, nonce: [...nonce], ciphertext: [...ciphertext] },
                },
            }),
            { mode: 0o600 },
        )
        await writeFile(join(app, 'proxy/fixture.txt'), 'old controller state', { mode: 0o600 })
        await writeFile(join(app, 'proxy/active.conf'), 'runtime-only configuration', {
            mode: 0o600,
        })
        await writeFile(join(app, 'crowdsec/bouncer/caddy-bouncer-key'), 'a'.repeat(64), {
            mode: 0o600,
        })
        if (scenario === 'agent-roundtrip') {
            await mkdir(join(directory, 'source'))
            await writeFile(
                join(directory, 'source/backup-source.json'),
                JSON.stringify({
                    imageId: null,
                    revision: null,
                    version: 'coverage-fixture',
                    buildSha256: 'f'.repeat(64),
                }),
                { mode: 0o600 },
            )
            const agentModule = (await import(
                pathToFileURL(join(code, 'docker/production/backups/agent.ts')).href
            )) as typeof import('../../../../docker/production/backups/agent.ts')
            runningAgent = await agentModule.startBackupAgent()
        }
        const engine =
            runningAgent?.engine ??
            (await createManagedBackupEngine({
                read: async () => null,
                write: async (state) => {
                    await storage.writePrivateJson(storage.stateFile, state)
                    await restore.writeMaintenanceProgress(state.maintenance ?? null)
                },
                now: Date.now,
                id: randomUUID,
                source: () => ({
                    imageId: null,
                    revision: null,
                    version: 'coverage-fixture',
                    buildSha256: 'f'.repeat(64),
                }),
                execute: async (job) => {
                    await exporter.exportManagedBackup(job.id)
                    const result = await verifyPublishedBackup(join(storage.artifactsRoot, job.id))
                    return {
                        id: job.id,
                        metadataSha256: result.metadataSha256,
                        bytes: result.bytes,
                    }
                },
                verify: async (job) => {
                    const result = await verifyPublishedBackup(join(storage.artifactsRoot, job.id))
                    return (
                        result.metadataSha256 === job.artifact?.metadataSha256 &&
                        result.bytes === job.artifact.bytes
                    )
                },
                remove: async () => {
                    throw new Error('Fixture must not prune a recovery point')
                },
                restore: async (_job, operation) => {
                    const acknowledgement = join(restore.maintenanceRoot, 'web-quiesced.json')
                    await writeFile(
                        acknowledgement,
                        JSON.stringify({ id: operation.id, quiescedAt: Date.now() }),
                        { mode: 0o600 },
                    )
                    if (scenario !== 'precommit-failure') await chown(acknowledgement, 10002, 10002)
                    await restore.restoreManagedBackup(operation.id)
                },
            }))
        async function settle(kind: 'backup' | 'restore') {
            if (!runningAgent) {
                await engine.tick()
                return
            }
            const deadline = Date.now() + 30_000
            while (!(await lstat(join(control, 'request.json')).catch(() => null))) {
                if (Date.now() > deadline)
                    throw new Error('Owned supervisor did not receive agent request.')
                await Bun.sleep(25)
            }
            const request = JSON.parse(await readFile(join(control, 'request.json'), 'utf8')) as {
                id: string
                kind?: string
            }
            const reportedKind = await command([
                process.execPath,
                '--no-env-file',
                join(code, 'docker/production/backups/export.ts'),
                '--request-kind',
            ])
            await rename(join(control, 'request.json'), join(control, 'active.json'))
            const reportedId = await command([
                process.execPath,
                '--no-env-file',
                join(code, 'docker/production/backups/export.ts'),
                '--request-id',
            ])
            supervisorIdentityVerified = reportedKind === kind && reportedId === request.id
            if (!supervisorIdentityVerified)
                throw new Error('Supervisor request identity mismatch.')
            if (kind === 'restore') {
                const acknowledgement = join(restore.maintenanceRoot, 'web-quiesced.json')
                await writeFile(
                    acknowledgement,
                    JSON.stringify({ id: request.id, quiescedAt: Date.now() }),
                    { mode: 0o600 },
                )
                await chown(acknowledgement, 10002, 10002)
            }
            await command([
                process.execPath,
                '--no-env-file',
                join(code, 'docker/production/backups/export.ts'),
                kind === 'restore' ? '--restore' : '--run',
                request.id,
            ])
            await command([
                process.execPath,
                '--no-env-file',
                join(code, 'docker/production/backups/export.ts'),
                '--result',
                request.id,
                'success',
            ])
            while (true) {
                const status = await engine.status()
                const state =
                    kind === 'restore'
                        ? status.maintenance?.state
                        : status.jobs.find((job) => job.id === request.id)?.state
                if (
                    state &&
                    state !== 'queued' &&
                    state !== 'running' &&
                    !(await lstat(join(control, 'active.json')).catch(() => null))
                )
                    break
                if (Date.now() > deadline)
                    throw new Error('Owned supervisor completion did not settle.')
                await Bun.sleep(25)
            }
        }
        const job = await engine.start({ actorId, requestId: randomUUID() })
        await settle('backup')
        let afterExport = await engine.status()
        if (afterExport.jobs[0]?.state !== 'succeeded')
            throw new Error('Real fixture export did not succeed.')
        const artifact = join(storage.artifactsRoot, job.id)
        const hashesBefore = await artifactHashes(artifact)
        let downloadVerified = false
        let secondBackupId: string | undefined
        let secondBackupHashes: Record<string, string> | undefined
        if (runningAgent) {
            const response = await fetch(`http://localhost/artifacts/${job.id}/download`, {
                unix: join(control, 'agent.sock'),
            })
            if (response.status !== 200) throw new Error('Owned artifact download failed.')
            const download = join(directory, 'download.tar')
            await writeFile(download, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 })
            const extracted = join(directory, 'downloaded-artifact')
            await mkdir(extracted, { mode: 0o700 })
            await command(['tar', '--extract', '--file=' + download, '--directory=' + extracted])
            const downloaded = await verifyPublishedBackup(extracted)
            downloadVerified =
                downloaded.metadataSha256 === afterExport.jobs[0]!.artifact!.metadataSha256 &&
                downloaded.bytes === afterExport.jobs[0]!.artifact!.bytes
            const newer = await engine.start({ actorId, requestId: randomUUID() })
            await settle('backup')
            afterExport = await engine.status()
            secondBackupId = newer.id
            secondBackupHashes = await artifactHashes(join(storage.artifactsRoot, newer.id))
        }
        const rotatedKey = join(directory, 'rotated-app-key')
        await writeFile(rotatedKey, Buffer.alloc(32, 9).toString('base64'), { mode: 0o600 })
        await bootstrap.beginAppEncryptionKeyRestore(rotatedKey)
        await bootstrap.completeAppEncryptionKeyRestore()
        await command(
            psql,
            `DELETE FROM rentnerproxy.sessions; INSERT INTO rentnerproxy.sessions(id,user_id,token_hash,expires_at,oidc_proof) VALUES ('${liveSession}','${actorId}','${'b'.repeat(64)}','2099-01-01',NULL); UPDATE rentnerproxy.system_settings SET value='2' WHERE key='orchestration_fixture';`,
        )
        await writeFile(join(app, 'proxy/fixture.txt'), 'new controller state')
        await writeFile(join(app, 'crowdsec/bouncer/caddy-bouncer-key'), 'b'.repeat(64))
        if (scenario === 'postcommit-failure') {
            await rm(join(app, 'proxy'), { recursive: true })
            await writeFile(join(app, 'proxy'), 'unsafe replacement obstacle')
        }
        await engine.requestMaintenance(
            job.id,
            {
                actorId,
                actorName: 'Fixture',
                requestId: randomUUID(),
                metadataSha256: afterExport.jobs[0]!.artifact!.metadataSha256,
            },
            'restore',
        )
        await settle('restore')
        const afterRestore = await engine.status()
        const operationId = afterRestore.maintenance!.id
        const journalExists = Boolean(
            await lstat(join(app, 'bootstrap/production-restore-v1.json')).catch(() => null),
        )
        const snapshotExists = Boolean(
            await lstat(join(storage.backupRoot, '.restore-' + operationId)).catch(() => null),
        )
        const controller = await readFile(join(app, 'proxy/fixture.txt'), 'utf8').catch(() => null)
        const hashesUnchanged =
            JSON.stringify(hashesBefore) === JSON.stringify(await artifactHashes(artifact))
        let selectedDeleteSafe = false
        if (runningAgent && secondBackupId) {
            await engine.requestMaintenance(
                job.id,
                {
                    actorId,
                    requestId: randomUUID(),
                    metadataSha256: afterExport.jobs[0]!.artifact!.metadataSha256,
                },
                'delete',
            )
            const deletionDeadline = Date.now() + 10_000
            while (['queued', 'running'].includes((await engine.status()).maintenance!.state)) {
                if (Date.now() > deletionDeadline) throw new Error('Owned deletion did not settle.')
                await Bun.sleep(25)
            }
            const deleted = await engine.status()
            selectedDeleteSafe =
                deleted.maintenance?.state === 'succeeded' &&
                deleted.jobs.length === 1 &&
                deleted.jobs[0]?.id === secondBackupId &&
                !(await lstat(artifact).catch(() => null)) &&
                JSON.stringify(secondBackupHashes) ===
                    JSON.stringify(
                        await artifactHashes(join(storage.artifactsRoot, secondBackupId)),
                    )
        }
        return {
            exportState: afterExport.jobs[0]!.state,
            supervisorIdentityVerified,
            downloadVerified,
            selectedDeleteSafe,
            restoreState: afterRestore.maintenance!.state,
            phase: JSON.parse(await readFile(join(control, 'restore-progress.json'), 'utf8')).phase,
            databaseValue: await command(
                psql,
                "SELECT value::text FROM rentnerproxy.system_settings WHERE key='orchestration_fixture'",
            ),
            sessions: await command(psql, 'SELECT id FROM rentnerproxy.sessions ORDER BY id'),
            controller,
            journalExists,
            snapshotExists,
            keyMatchesBackup:
                (await readFile(join(directory, 'runtime/app-key/value'), 'utf8')).trim() ===
                key.toString('base64'),
            pendingKeyJournal: Boolean(
                await lstat(join(app, 'bootstrap/app-key-restore-v1.json')).catch(() => null),
            ),
            hashesUnchanged,
            inventoryUnchanged:
                JSON.stringify(afterExport.jobs) === JSON.stringify(afterRestore.jobs),
            runtimeConfigExcluded: !(await lstat(join(app, 'proxy/active.conf')).catch(() => null)),
            ddnsPaused: Boolean(
                await lstat(join(app, 'proxy/ddns-restore-paused')).catch(() => null),
            ),
            discoveryPaused: Boolean(
                await lstat(join(app, 'proxy/docker-discovery-restore-paused')).catch(() => null),
            ),
            crowdsecKey: await readFile(join(app, 'crowdsec/bouncer/caddy-bouncer-key'), 'utf8'),
        }
    } finally {
        runningAgent?.shutdown()
        if (postgres) {
            postgres.kill('SIGTERM')
            const timeout = setTimeout(() => postgres?.kill('SIGKILL'), 5000)
            try {
                await postgres.exited
            } finally {
                clearTimeout(timeout)
            }
        }
        await rm(directory, { recursive: true, force: true })
    }
}

async function artifactHashes(directory: string): Promise<Record<string, string>> {
    return Object.fromEntries(
        await Promise.all(
            (await readdir(directory)).toSorted().map(async (name) => [
                name,
                createHash('sha256')
                    .update(await readFile(join(directory, name)))
                    .digest('hex'),
            ]),
        ),
    )
}

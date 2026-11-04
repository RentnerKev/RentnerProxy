// oxlint-disable no-await-in-loop -- A single disposable appliance is seeded, backed up, restored and verified in sequence.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashOciFile, ociDigest, ociRecord, ociText, readOciJson } from '../lib/oci-layout.ts'
import { runSmokeProcess } from '../../../scripts/smoke/process.ts'
import { smokeCompose, smokeDockerArguments } from '../../../scripts/smoke/resources.ts'
import { waitForSmoke } from '../../../scripts/smoke/wait.ts'
import { seedBackupState, assertBackupState } from './fixtures/backup-state.ts'
import {
    seedPersistenceFixture,
    readPersistenceSnapshot,
    assertPersistenceFixture,
    assertPersistenceRequestDecrypts,
} from './fixtures/persistence/state.ts'
import { assertFreshExternalDefaults } from './release-compatibility/state.ts'
import {
    parsePlatformBackupBundle,
    validatePlatformBackupEntries,
} from './platform-backup.validation.ts'

const repository = fileURLToPath(new URL('../../..', import.meta.url))
let stage = 'prepare'

async function run(action: string): Promise<void> {
    if (action !== 'export' && action !== 'restore') throw new Error('Expected export or restore')
    if (process.platform !== 'linux' || process.arch !== (action === 'export' ? 'x64' : 'arm64'))
        throw new Error('Portable backups require native AMD64 export and ARM64 restore')
    process.umask(0o077)
    const directory = resolve(ociText(process.env.PORTABLE_DIRECTORY))
    const image = ociText(process.env.PORTABLE_IMAGE)
    const revision = ociText(process.env.REVISION)
    const version = ociText(process.env.VERSION)
    const targetManifest = ociDigest(process.env.PORTABLE_MANIFEST)
    const work = await mkdtemp(join(tmpdir(), 'rp-platform-'))
    const project = 'rp-platform-' + randomUUID().replaceAll('-', '').slice(0, 12)
    const file = join(work, 'compose.json')
    const environment: NodeJS.ProcessEnv = {
        ...process.env,
        COMPOSE_DISABLE_ENV_FILE: '1',
        RENTNERPROXY_COMPOSE_FILE: file,
    }
    for (const key of [
        'APP_ENCRYPTION_KEY',
        'DATABASE_URL',
        'POSTGRES_PASSWORD',
        'RENTNERPROXY_APP_KEY_FILE',
        'RENTNERPROXY_CONTROLLER_TOKEN',
    ])
        delete environment[key]
    const command = async (args: string[], timeoutMs = 120_000): Promise<string> => {
        const result = await runSmokeProcess(smokeDockerArguments(args), {
            cwd: repository,
            env: environment,
            timeoutMs,
        })
        if (result.exitCode !== 0 || result.timedOut)
            throw new Error('Portable backup command failed')
        return result.stdout.trim()
    }
    const compose = ['docker', 'compose', '--project-name', project, '--file', file]
    const container = async () => {
        const id = await command([...compose, 'ps', '--all', '--quiet', 'rentnerproxy'])
        assert.match(id, /^[a-f0-9]{12,64}$/u)
        return id
    }
    const healthy = async () => {
        const id = await container()
        await waitForSmoke(
            async () =>
                (await command([
                    'docker',
                    'inspect',
                    '--format',
                    '{{if .State.Health}}{{.State.Health.Status}}{{end}}',
                    id,
                ])) === 'healthy',
            {
                timeoutMs: 240_000,
                intervalMs: 500,
                timeoutError: () => new Error('Portable appliance readiness timed out'),
            },
        )
        return id
    }
    await writeFile(
        file,
        smokeCompose(
            JSON.stringify({
                services: {
                    rentnerproxy: {
                        image,
                        environment: {
                            PUBLIC_ORIGIN: 'https://management.platform.invalid',
                            PROXY_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
                            SMTP_FROM: 'fixture@platform.invalid',
                            SMTP_HOST: 'smtp.platform.invalid',
                            SMTP_USER: 'fixture',
                            SMTP_PASSWORD: 'isolated-platform-fixture',
                            SMTP_PORT: '587',
                            SMTP_SECURE: 'false',
                        },
                        volumes: ['data:/var/lib/rentnerproxy', 'postgres:/var/lib/postgresql'],
                    },
                },
                volumes: { data: {}, postgres: {} },
            }),
        ),
    )
    try {
        const actualArchitecture = await command([
            'docker',
            'image',
            'inspect',
            '--format',
            '{{.Architecture}}',
            image,
        ])
        assert.equal(actualArchitecture, action === 'export' ? 'amd64' : 'arm64')
        if (action === 'export') {
            stage = 'source-startup'
            await command([...compose, 'up', '--detach'], 900_000)
            const id = await healthy()
            stage = 'source-state'
            const runId = randomUUID().replaceAll('-', '').slice(0, 12)
            const backupState = await seedBackupState({ command, containerId: id, runId })
            const persistence = await seedPersistenceFixture({
                command,
                containerId: id,
                runId,
                withDnsCredential: true,
                withCandidate: true,
            })
            await assertPersistenceRequestDecrypts({
                command,
                containerId: id,
                fixture: persistence,
            })
            const snapshot = await readPersistenceSnapshot({
                command,
                containerId: id,
                fixture: persistence,
            })
            stage = 'source-backup'
            const output = join(directory, 'export')
            await command(
                [
                    process.execPath,
                    '--no-env-file',
                    'scripts/production-backup.ts',
                    '--project',
                    project,
                    '--output',
                    output,
                ],
                900_000,
            )
            const entries = await readdir(output)
            assert.equal(entries.length, 1)
            assert.match(entries[0]!, /^rentnerproxy-[0-9]{14}-[a-f0-9]{8}$/u)
            await chmod(directory, 0o700)
            await rename(join(output, entries[0]!), join(directory, 'backup'))
            await rmdir(output)
            const metadata = ociRecord(await readOciJson(join(directory, 'backup/metadata.json')))
            assert.equal(metadata.version, 4)
            const files = Object.fromEntries(
                await Promise.all(
                    [
                        'metadata.json',
                        'app-encryption-key',
                        'postgres.dump',
                        'controller-state.tar',
                        'crowdsec-state.tar',
                    ].map(async (name) => [
                        name,
                        (await hashOciFile(join(directory, 'backup', name))).slice(7),
                    ]),
                ),
            )
            const bundle = parsePlatformBackupBundle({
                schemaVersion: 1,
                source: {
                    architecture: 'amd64',
                    revision,
                    version,
                    manifestDigest: targetManifest,
                },
                backupState,
                persistence,
                snapshot,
                files,
            })
            await writeFile(join(directory, 'bundle.json'), JSON.stringify(bundle) + '\n', {
                flag: 'wx',
                mode: 0o600,
            })
            console.log(
                'PASS native AMD64 v4 backup preserves the fixture encryption key and durable state',
            )
        } else {
            stage = 'backup-validation'
            const archive = resolve(ociText(process.env.PORTABLE_ARCHIVE))
            const names = (
                await command(['tar', '--list', '--file=' + archive, '--quoting-style=escape'])
            ).split('\n')
            const types = (
                await command([
                    'tar',
                    '--list',
                    '--verbose',
                    '--file=' + archive,
                    '--quoting-style=escape',
                ])
            )
                .split('\n')
                .map((line) => line[0] ?? '')
            validatePlatformBackupEntries(names, types)
            await mkdir(directory, { recursive: true, mode: 0o700 })
            await command([
                'tar',
                '--extract',
                '--file=' + archive,
                '--directory=' + directory,
                '--no-same-owner',
                '--no-same-permissions',
            ])
            const bundle = parsePlatformBackupBundle(
                await readOciJson(join(directory, 'bundle.json')),
            )
            assert.equal(bundle.source.revision, revision)
            assert.equal(bundle.source.version, version)
            assert.equal(bundle.source.manifestDigest, process.env.SOURCE_MANIFEST)
            for (const [name, expected] of Object.entries(bundle.files))
                assert.equal(
                    (await hashOciFile(join(directory, 'backup', name))).slice(7),
                    expected,
                )
            assert.equal(
                ociRecord(await readOciJson(join(directory, 'backup/metadata.json'))).version,
                4,
            )
            stage = 'target-restore'
            await command(
                [
                    process.execPath,
                    '--no-env-file',
                    'scripts/production-restore.ts',
                    '--project',
                    project,
                    '--input',
                    join(directory, 'backup'),
                    '--confirm-replace',
                ],
                900_000,
            )
            const verify = async () => {
                const id = await healthy()
                await assertBackupState({ command, containerId: id, fixture: bundle.backupState })
                await assertPersistenceFixture({
                    command,
                    containerId: id,
                    fixture: bundle.persistence,
                    expected: bundle.snapshot,
                })
                await assertPersistenceRequestDecrypts({
                    command,
                    containerId: id,
                    fixture: bundle.persistence,
                })
                await assertFreshExternalDefaults(command, id)
            }
            stage = 'target-state'
            await verify()
            stage = 'target-recreate'
            await command([...compose, 'up', '--detach', '--force-recreate'], 900_000)
            await verify()
            const proof = {
                schemaVersion: 1,
                revision,
                version,
                sourceManifest: bundle.source.manifestDigest,
                targetManifest,
                backupVersion: 4,
                checks: 'amd64-backup-to-native-arm64',
                nativeUpgradeSources: [],
            }
            await writeFile(ociText(process.env.PORTABILITY_REPORT), JSON.stringify(proof) + '\n', {
                flag: 'wx',
            })
            console.log(
                'PASS native ARM64 restores an AMD64 v4 backup, decrypts its protected state and survives recreation',
            )
        }
    } finally {
        await command([...compose, 'down', '--volumes', '--remove-orphans'], 180_000)
        await rm(work, { recursive: true, force: true })
    }
}

if (import.meta.main) {
    try {
        await run(process.argv[2] ?? '')
    } catch {
        console.error('Cross-architecture backup validation failed during ' + stage)
        process.exitCode = 1
    }
}

// oxlint-disable no-await-in-loop -- Isolate invalid inputs and verify cleanup after every failure.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
    chmod,
    copyFile,
    link,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    symlink,
    writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'bun:test'
import { recoverOffHostBackup } from '../../../../scripts/recover-offhost-backup.ts'
import {
    createRecoveryKey,
    encryptBackup,
    recoveryKeyId,
} from '../../../../scripts/backup/offhost/envelope.ts'
import { parseBackupMetadata } from '../../../../scripts/backup/format.ts'
import {
    publishProductionBackup,
    verifyPublishedBackup,
} from '../../../../scripts/backup/publication.ts'

const root = resolve(import.meta.dir, '../../../..')
const failure =
    'Off-host backup recovery failed. Check the private target and recovery-key files, object and destination, then retry. No production restore was started.'
const names = [
    'metadata.json',
    'app-encryption-key',
    'postgres.dump',
    'controller-state.tar',
    'crowdsec-state.tar',
]
const target = {
    endpoint: 'https://storage.example.test',
    region: 'test-1',
    bucket: 'recovery-fixture',
    prefix: 'rentner/production',
    accessKeyId: 'fixtureAccessKey',
    secretAccessKey: 'SYNTHETIC-SECRET-DO-NOT-PRINT',
}
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

function directoryArchive() {
    const header = Buffer.alloc(512)
    header.write('./')
    header.write('0000700\0', 100)
    header.write('00000000000\0', 124)
    header.fill(32, 148, 156)
    header[156] = 53
    header.write(
        header
            .reduce((sum, byte) => sum + byte, 0)
            .toString(8)
            .padStart(6, '0') + '\0 ',
        148,
    )
    return Buffer.concat([header, Buffer.alloc(1024)])
}

async function fixture(
    run: (context: {
        directory: string
        original: string
        encrypted: string
        output: string
        targetFile: string
        keyFile: string
        recoveryKey: string
        args: string[]
        download: (object: string, outputFile: string, signal: AbortSignal) => Promise<void>
    }) => Promise<void>,
) {
    await mkdir(join(root, 'tmp'), { recursive: true })
    const directory = await mkdtemp(join(root, 'tmp', 'recover-offhost-'))
    try {
        const original = join(directory, 'original-volume')
        const staging = join(directory, 'staging')
        await mkdir(staging, { mode: 0o700 })
        const key = Buffer.from(Buffer.alloc(32, 17).toString('base64') + '\n')
        const dump = Buffer.alloc(150_000, 29)
        const archive = directoryArchive()
        await Promise.all([
            writeFile(join(staging, 'app-encryption-key'), key),
            writeFile(join(staging, 'postgres.dump'), dump),
            writeFile(join(staging, 'controller-state.tar'), archive),
            writeFile(join(staging, 'crowdsec-state.tar'), archive),
        ])
        await publishProductionBackup(
            staging,
            original,
            parseBackupMetadata({
                format: 'rentnerproxy-production-backup',
                version: 4,
                createdAt: '2026-10-31T00:00:00.000Z',
                redis: 'excluded',
                applicationEncryptionKey: {
                    file: 'app-encryption-key',
                    bytes: key.length,
                    sha256: digest(key),
                },
                postgres: {
                    database: 'rentnerproxy',
                    user: 'rentnerproxy',
                    dump: 'postgres.dump',
                    bytes: dump.length,
                    sha256: digest(dump),
                },
                controllerState: {
                    archive: 'controller-state.tar',
                    bytes: archive.length,
                    sha256: digest(archive),
                },
                crowdSecState: {
                    archive: 'crowdsec-state.tar',
                    bytes: archive.length,
                    sha256: digest(archive),
                },
                deployment: {
                    publicOrigin: 'https://proxy.example.test',
                    trustedProxyCidrs: '127.0.0.1/32',
                },
                source: {
                    imageId: null,
                    revision: 'a'.repeat(40),
                    version: '0.0.0-test',
                    buildSha256: 'b'.repeat(64),
                },
            }),
        )
        const encrypted = join(directory, 'remote-object.rpbk')
        const recoveryKey = createRecoveryKey()
        await encryptBackup(original, encrypted, recoveryKey)
        // The entire original volume is gone before recovery starts.
        await rm(original, { recursive: true, force: true })
        const targetFile = join(directory, 'target.json')
        const keyFile = join(directory, 'recovery-key.json')
        await writeFile(targetFile, JSON.stringify(target), { flag: 'wx', mode: 0o600 })
        await writeFile(
            keyFile,
            JSON.stringify({
                format: 'rentnerproxy-off-host-recovery-key',
                version: 1,
                recoveryKey,
                keyId: recoveryKeyId(recoveryKey),
            }),
            { flag: 'wx', mode: 0o600 },
        )
        const output = join(directory, 'recovered')
        const args = [
            '--target-file',
            targetFile,
            '--key-file',
            keyFile,
            '--object',
            'targetId/jobId.rpbk',
            '--output',
            output,
        ]
        const download = async (object: string, outputFile: string, signal: AbortSignal) => {
            signal.throwIfAborted()
            assert.equal(object, 'targetId/jobId.rpbk')
            if (process.platform !== 'win32')
                assert.equal((await stat(resolve(outputFile, '..'))).mode & 0o777, 0o700)
            await copyFile(encrypted, outputFile, constants.COPYFILE_EXCL)
        }
        await run({
            directory,
            original,
            encrypted,
            output,
            targetFile,
            keyFile,
            recoveryKey,
            args,
            download,
        })
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

function safeFailure(error: unknown): boolean {
    assert.ok(error instanceof Error)
    assert.equal(error.message, failure)
    assert.equal(error.cause, undefined)
    return true
}

async function noTemporaryDirectories(directory: string) {
    assert.deepEqual(
        (await readdir(directory)).filter((name) => name.startsWith('.rentnerproxy-')),
        [],
    )
}

test('recovers the complete v4 backup on a fresh host without its original volume', () =>
    fixture(async ({ directory, original, encrypted, output, args, download }) => {
        await assert.rejects(stat(original), /ENOENT/)
        const ciphertext = await readFile(encrypted)
        const result = await recoverOffHostBackup(args, { download })
        assert.deepEqual(result, { outputDirectory: output })
        assert.deepEqual((await readdir(output)).toSorted(), names.toSorted())
        const verified = await verifyPublishedBackup(output)
        assert.equal(verified.metadata.version, 4)
        assert.equal(
            verified.metadata.applicationEncryptionKey.sha256,
            digest(await readFile(join(output, 'app-encryption-key'))),
        )
        assert.deepEqual(await readFile(encrypted), ciphertext)
        if (process.platform !== 'win32') {
            assert.equal((await stat(output)).mode & 0o777, 0o700)
            for (const name of names)
                assert.equal((await stat(join(output, name))).mode & 0o777, 0o600)
        }
        await noTemporaryDirectories(directory)
    }))

test('accepts the recovery-key JSON downloaded by the UI without an optional key identifier', () =>
    fixture(async ({ args, download, keyFile, recoveryKey, output }) => {
        await writeFile(
            keyFile,
            JSON.stringify({
                format: 'rentnerproxy-off-host-recovery-key',
                version: 1,
                recoveryKey,
            }),
        )
        await recoverOffHostBackup(args, { download })
        assert.equal((await verifyPublishedBackup(output)).metadata.version, 4)
    }))

test('rejects missing, duplicate, unknown, positional and unsafe argv without fetching', async () => {
    let downloads = 0
    const download = async () => {
        downloads++
    }
    const valid = [
        '--target-file',
        'target.json',
        '--key-file',
        'key.json',
        '--object',
        'target/job.rpbk',
        '--output',
        'backup',
    ]
    const invalid = [
        [],
        valid.slice(0, -1),
        [...valid, 'extra'],
        [...valid, '--object', 'target/other.rpbk'],
        [...valid, '--secret-access-key', 'SYNTHETIC-ARGV-SECRET'],
        [...valid, '--endpoint', 'https://not-allowed.test'],
    ]
    for (const object of [
        '../job.rpbk',
        'target/../job.rpbk',
        'target/job.rpbk/extra',
        '/target/job.rpbk',
        'target\\job.rpbk',
        'target/job%2Frpbk',
        'target/job.rpbk\n',
        'https://provider.test/backup',
    ]) {
        const changed = [...valid]
        changed[5] = object
        invalid.push(changed)
    }
    for (const timeout of ['0', '-1', '7201', '1.5', 'Infinity', '0001'])
        invalid.push([...valid, '--timeout-seconds', timeout])
    invalid.push([...valid.slice(0, -1), 'unsafe\npath'])
    for (const args of invalid)
        await assert.rejects(recoverOffHostBackup(args, { download }), safeFailure)
    assert.equal(downloads, 0)
})

test('requires both private JSON files and rejects malformed, oversized and empty contents before downloading', () =>
    fixture(async ({ directory, args, download, targetFile, keyFile, output }) => {
        let downloads = 0
        const guarded = async (...parameters: Parameters<typeof download>) => {
            downloads++
            await download(...parameters)
        }
        for (const [path, limit] of [
            [targetFile, 8192],
            [keyFile, 4096],
        ] as const) {
            const original = await readFile(path)
            await rm(path)
            await assert.rejects(recoverOffHostBackup(args, { download: guarded }), safeFailure)
            await mkdir(path)
            await assert.rejects(recoverOffHostBackup(args, { download: guarded }), safeFailure)
            await rm(path, { recursive: true })
            for (const invalid of [
                Buffer.alloc(0),
                Buffer.from('{"SYNTHETIC-JSON-SECRET":'),
                Buffer.alloc(limit + 1, 32),
                Buffer.from([0xff, 0xfe]),
            ]) {
                await writeFile(path, invalid, { mode: 0o600 })
                await assert.rejects(recoverOffHostBackup(args, { download: guarded }), safeFailure)
                await assert.rejects(stat(output), /ENOENT/)
                await noTemporaryDirectories(directory)
            }
            await writeFile(path, original, { mode: 0o600 })
        }
        assert.equal(downloads, 0)
    }))

test('strictly validates target JSON and recovery-key format, canonical key and optional identifier', () =>
    fixture(async ({ directory, args, targetFile, keyFile, recoveryKey }) => {
        const originalTarget = await readFile(targetFile)
        const originalKey = await readFile(keyFile)
        let downloads = 0
        const download = async () => {
            downloads++
        }
        for (const invalid of [
            null,
            [],
            {},
            { ...target, extra: 'unexpected' },
            { ...target, secretAccessKey: 7 },
            { ...target, endpoint: 'https://user:password@provider.test' },
            { ...target, prefix: '../escape' },
            { ...target, region: 'wrong/region' },
            { ...target, accessKeyId: 'with spaces' },
        ]) {
            await writeFile(targetFile, JSON.stringify(invalid))
            await assert.rejects(recoverOffHostBackup(args, { download }), safeFailure)
        }
        await writeFile(targetFile, originalTarget)
        const key = { format: 'rentnerproxy-off-host-recovery-key', version: 1, recoveryKey }
        for (const invalid of [
            null,
            [],
            {},
            { ...key, format: 'wrong' },
            { ...key, version: 2 },
            { ...key, extra: 'unexpected' },
            { ...key, recoveryKey: recoveryKey + '\n' },
            { ...key, recoveryKey: 'A'.repeat(42) + 'B=' },
            { ...key, keyId: '0'.repeat(64) },
        ]) {
            await writeFile(keyFile, JSON.stringify(invalid))
            await assert.rejects(recoverOffHostBackup(args, { download }), safeFailure)
        }
        await writeFile(keyFile, originalKey)
        assert.equal(downloads, 0)
        await noTemporaryDirectories(directory)
    }))

test.skipIf(process.platform === 'win32')(
    'rejects group/world permissions, secret-file links and linked parent directories',
    () =>
        fixture(async ({ directory, args, targetFile, keyFile }) => {
            let downloads = 0
            const download = async () => {
                downloads++
            }
            for (const path of [targetFile, keyFile]) {
                for (const mode of [0o640, 0o604, 0o620, 0o601]) {
                    await chmod(path, mode)
                    await assert.rejects(recoverOffHostBackup(args, { download }), safeFailure)
                }
                await chmod(path, 0o600)
                const alias = path + '.alias'
                await link(path, alias)
                await assert.rejects(recoverOffHostBackup(args, { download }), safeFailure)
                await rm(alias)
                const original = await readFile(path)
                const held = path + '.held'
                await writeFile(held, original, { mode: 0o600 })
                await rm(path)
                await symlink(held, path)
                await assert.rejects(recoverOffHostBackup(args, { download }), safeFailure)
                await rm(path)
                await writeFile(path, original, { mode: 0o600 })
                await rm(held)
            }
            const alias = join(directory, 'linked-parent')
            await symlink(directory, alias, 'dir')
            const altered = [...args]
            altered[1] = join(alias, 'target.json')
            await assert.rejects(recoverOffHostBackup(altered, { download }), safeFailure)
            assert.equal(downloads, 0)
            await noTemporaryDirectories(directory)
        }),
)

test('download errors and cancellation clean all owned files and preserve caller files', () =>
    fixture(async ({ directory, args, download, encrypted, output, targetFile, keyFile }) => {
        const originals = await Promise.all(
            [encrypted, targetFile, keyFile].map((path) => readFile(path)),
        )
        await assert.rejects(
            recoverOffHostBackup(args, {
                download: async (_object, path) => {
                    await writeFile(path + '.partial', 'partial encrypted download')
                    throw new Error('SYNTHETIC-PROVIDER-SECRET ' + target.secretAccessKey)
                },
            }),
            safeFailure,
        )
        await assert.rejects(stat(output), /ENOENT/)
        await noTemporaryDirectories(directory)
        const controller = new AbortController()
        await assert.rejects(
            recoverOffHostBackup(args, {
                signal: controller.signal,
                download: async (...parameters) => {
                    await download(...parameters)
                    controller.abort(new Error('SYNTHETIC-ABORT-SECRET'))
                },
            }),
            safeFailure,
        )
        await assert.rejects(stat(output), /ENOENT/)
        await noTemporaryDirectories(directory)
        for (const [index, path] of [encrypted, targetFile, keyFile].entries())
            assert.deepEqual(await readFile(path), originals[index])
    }))

test('a bounded deadline cancels a stalled mocked download and removes its partial files', () =>
    fixture(async ({ directory, args, output }) => {
        const started = performance.now()
        await assert.rejects(
            recoverOffHostBackup([...args, '--timeout-seconds', '1'], {
                download: async (_object, path, signal) => {
                    await writeFile(path, 'partial fixture')
                    await new Promise<void>((_resolve, reject) => {
                        const stop = () => reject(new Error('mock cancelled'))
                        signal.addEventListener('abort', stop, { once: true })
                        if (signal.aborted) stop()
                    })
                },
            }),
            safeFailure,
        )
        assert.ok(performance.now() - started < 4000)
        await assert.rejects(stat(output), /ENOENT/)
        await noTemporaryDirectories(directory)
    }))

test('authentication failure cleans private staging without modifying encrypted input', () =>
    fixture(async ({ directory, args, download, encrypted, output, keyFile }) => {
        const original = await readFile(encrypted)
        const wrongKey = createRecoveryKey()
        await writeFile(
            keyFile,
            JSON.stringify({
                format: 'rentnerproxy-off-host-recovery-key',
                version: 1,
                recoveryKey: wrongKey,
            }),
        )
        await assert.rejects(recoverOffHostBackup(args, { download }), safeFailure)
        await assert.rejects(stat(output), /ENOENT/)
        assert.deepEqual(await readFile(encrypted), original)
        await noTemporaryDirectories(directory)
    }))

test('existing and concurrently created destinations are preserved without overwrite', () =>
    fixture(async ({ directory, args, download, output }) => {
        for (const nonempty of [false, true]) {
            await mkdir(output)
            if (nonempty) await writeFile(join(output, 'marker'), 'existing caller data')
            await assert.rejects(
                recoverOffHostBackup(args, {
                    download: async () => {
                        assert.fail('must not download for an existing destination')
                    },
                }),
                safeFailure,
            )
            assert.deepEqual(await readdir(output), nonempty ? ['marker'] : [])
            await rm(output, { recursive: true })
        }
        await assert.rejects(
            recoverOffHostBackup(args, {
                download: async (...parameters) => {
                    await download(...parameters)
                    await mkdir(output)
                    await writeFile(join(output, 'marker'), 'concurrently created caller data')
                },
            }),
            safeFailure,
        )
        assert.equal(
            await readFile(join(output, 'marker'), 'utf8'),
            'concurrently created caller data',
        )
        await noTemporaryDirectories(directory)
    }))

test('already aborted recovery does not read missing files or invoke storage', async () => {
    const args = [
        '--target-file',
        'never-read-target',
        '--key-file',
        'never-read-key',
        '--object',
        'target/job.rpbk',
        '--output',
        'never-write-output',
    ]
    await assert.rejects(
        recoverOffHostBackup(args, {
            signal: AbortSignal.abort(new Error('SYNTHETIC-SECRET')),
            download: async () => {
                assert.fail('must not download')
            },
        }),
        safeFailure,
    )
})

async function runCli(args: string[]) {
    const child = Bun.spawn({
        cmd: [
            process.execPath,
            '--no-env-file',
            join(root, 'scripts/recover-offhost-backup.ts'),
            ...args,
        ],
        cwd: root,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ])
    return { exit, stdout, stderr }
}

test('CLI help documents the independent files and errors never echo raw arguments or secrets', async () => {
    const help = await runCli(['--help'])
    assert.equal(help.exit, 0)
    assert.match(help.stdout, /--target-file <target.json> --key-file <recovery-key.json>/)
    assert.equal(help.stderr, '')
    const invalid = await runCli(['--secret-access-key', 'SYNTHETIC-CLI-SECRET $(unsafe-command)'])
    assert.equal(invalid.exit, 1)
    assert.equal(invalid.stdout, '')
    assert.equal(invalid.stderr.trim(), failure)
    assert.equal(invalid.stderr.includes('SYNTHETIC-CLI-SECRET'), false)
    assert.equal(invalid.stderr.includes('unsafe-command'), false)
})

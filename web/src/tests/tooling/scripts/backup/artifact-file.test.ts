// oxlint-disable no-await-in-loop -- Exercise ordered file operations and independent parser cases.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
    mkdir,
    mkdtemp,
    open,
    readFile,
    rename,
    rm,
    stat,
    symlink,
    truncate,
    writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'bun:test'
import {
    parseApplicationEncryptionKeyFile,
    readFileRange,
    snapshotBackupArtifact,
    snapshotBackupArtifactFile,
    writeFileChunk,
} from '../../../../../../scripts/backup/artifact-file.ts'
import { createMaintenanceCommands } from '../../../../../../scripts/backup/maintenance-commands.ts'
import { runMaintenanceProcess } from '../../../../../../scripts/backup/maintenance-process.ts'
import {
    validateControllerEncryptionFile,
    validateStateArchiveFile,
} from '../../../../../../scripts/backup/format.ts'

const cwd = resolve(import.meta.dir, '../../../../../..')
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
async function fixture(run: (directory: string) => Promise<void>) {
    await mkdir(join(cwd, 'tmp'), { recursive: true })
    const directory = await mkdtemp(join(cwd, 'tmp', 'artifact-file-'))
    try {
        await run(directory)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

test('snapshots multi-MiB artifacts from the held source FD despite pathname replacement', () =>
    fixture(async (directory) => {
        const source = join(directory, 'source')
        const target = join(directory, 'snapshot')
        const original = Buffer.alloc(5 * 1024 ** 2 + 19, 0xa7)
        const expected = { bytes: original.length, sha256: digest(original) }
        await writeFile(source, original)
        const file = await open(source, 'r')
        try {
            await rename(source, source + '.held')
            await writeFile(source, 'replacement')
            await snapshotBackupArtifactFile(file, target, expected)
            assert.equal(digest(await readFile(target)), expected.sha256)
            if (process.platform !== 'win32') assert.equal((await stat(target)).mode & 0o777, 0o600)
            await assert.rejects(snapshotBackupArtifactFile(file, target, expected), /exist/i)
            assert.equal(digest(await readFile(target)), expected.sha256)
        } finally {
            await file.close()
        }
    }))

test('failed size/hash checks remove only the owned partial snapshot; short reads fail closed', () =>
    fixture(async (directory) => {
        const source = join(directory, 'source'),
            target = join(directory, 'target')
        await writeFile(source, 'fixture')
        await assert.rejects(
            snapshotBackupArtifact(source + '.missing', target, {
                bytes: 7,
                sha256: '0'.repeat(64),
            }),
            { message: 'backup file is missing, invalid or too large' },
        )
        await assert.rejects(
            snapshotBackupArtifact(source, target, { bytes: 7, sha256: '0'.repeat(64) }),
            /checksum/,
        )
        await assert.rejects(stat(target), /ENOENT/)
        await assert.rejects(
            snapshotBackupArtifact(source, target, { bytes: 8, sha256: '0'.repeat(64) }),
            /size/,
        )
        await assert.rejects(stat(target), /ENOENT/)
        const file = await open(source, 'r')
        try {
            await assert.rejects(readFileRange(file, 0, 8), /truncated/)
        } finally {
            await file.close()
        }
    }))

test.skipIf(process.platform === 'win32')(
    'snapshot rejects symlinks and preserves existing destination files',
    () =>
        fixture(async (directory) => {
            const source = join(directory, 'source'),
                target = join(directory, 'target')
            await writeFile(source, 'fixture')
            await symlink(source, source + '.link')
            await assert.rejects(
                snapshotBackupArtifact(source + '.link', target, {
                    bytes: 7,
                    sha256: digest(Buffer.from('fixture')),
                }),
            )
            await writeFile(target, 'existing')
            await assert.rejects(
                snapshotBackupArtifact(source, target, {
                    bytes: 7,
                    sha256: digest(Buffer.from('fixture')),
                }),
            )
            assert.equal(await readFile(target, 'utf8'), 'existing')
        }),
)

test('growth and shrink during snapshot copying fail and remove the owned partial file', () =>
    fixture(async (directory) => {
        for (const size of [65_536, 131_073]) {
            const source = join(directory, 'source'),
                target = join(directory, 'target')
            const original = Buffer.alloc(131_072, 7)
            await writeFile(source, original)
            const file = await open(source, 'r')
            const read = file.read.bind(file)
            let first = true
            Object.defineProperty(file, 'read', {
                value: async (buffer: Buffer, offset: number, length: number, position: number) => {
                    const result = await read(buffer, offset, length, position)
                    if (first) {
                        first = false
                        await truncate(source, size)
                    }
                    return result
                },
            })
            try {
                await assert.rejects(
                    snapshotBackupArtifactFile(file, target, {
                        bytes: original.length,
                        sha256: digest(original),
                    }),
                    /truncated|checksum/,
                )
                await assert.rejects(stat(target), /ENOENT/)
            } finally {
                await file.close()
            }
        }
    }))

test('file writes handle partial progress and reject zero progress or disk errors', async () => {
    const input = Buffer.from('fixture')
    let written = 0
    const partial = {
        write: async (_bytes: Uint8Array, _offset: number, length: number) => {
            const bytesWritten = Math.min(2, length)
            written += bytesWritten
            return { bytesWritten }
        },
    } as unknown as Parameters<typeof writeFileChunk>[0]
    await writeFileChunk(partial, input)
    assert.equal(written, input.length)
    await assert.rejects(
        writeFileChunk(
            { write: async () => ({ bytesWritten: 0 }) } as unknown as typeof partial,
            input,
        ),
        /no progress/,
    )
    await assert.rejects(
        writeFileChunk(
            {
                write: async () => {
                    throw new Error('disk failure')
                },
            } as unknown as typeof partial,
            input,
        ),
        /disk failure/,
    )
})

test('key streaming matches UTF8.toString().trim() and canonical base64 including large outer whitespace', () =>
    fixture(async (directory) => {
        const key = Buffer.alloc(32, 0x71).toString('base64')
        const cases = [
            key,
            ' \t\n' + key + '\r\n',
            ' '.repeat(65_535) + '\ufeff' + key + '\u00a0'.repeat(600_000),
            key.slice(0, 20) + ' ' + key.slice(20),
            key + ' x',
            key.replace(/=$/u, ''),
            key.slice(0, -2) + 'B=',
            '\u200b' + key,
            Buffer.concat([Buffer.from(key), Buffer.from([0xff])]),
        ]
        for (const input of cases) {
            const bytes = Buffer.from(input)
            const old = bytes.toString('utf8').trim()
            const valid =
                /^[A-Za-z0-9+/]{43}=$/u.test(old) &&
                Buffer.from(old, 'base64').length === 32 &&
                Buffer.from(old, 'base64').toString('base64') === old
            const path = join(directory, 'key')
            await writeFile(path, bytes)
            const file = await open(path, 'r')
            try {
                if (valid)
                    assert.deepEqual(
                        await parseApplicationEncryptionKeyFile(file),
                        Buffer.from(old, 'base64'),
                    )
                else
                    await assert.rejects(
                        parseApplicationEncryptionKeyFile(file),
                        /invalid backup application encryption key/,
                    )
            } finally {
                await file.close()
            }
        }
    }))

test('process file output hashes multi-MiB chunks without returning captured stdout', () =>
    fixture(async (directory) => {
        const target = join(directory, 'artifact')
        const result = await createMaintenanceCommands({ cwd, operation: 'backup' }).file(
            [
                process.execPath,
                '--no-env-file',
                '-e',
                'for(let i=0;i<80;i++)process.stdout.write(Buffer.alloc(65536,123))',
            ],
            target,
            'fixture stream',
            5000,
        )
        assert.equal(result.bytes, 80 * 65_536)
        assert.equal(result.sha256, digest(await readFile(target)))
        const file = await open(join(directory, 'empty-capture'), 'wx', 0o600)
        try {
            const streamed = await runMaintenanceProcess(
                [process.execPath, '--no-env-file', '-e', 'process.stdout.write("abc")'],
                { cwd, timeoutMs: 5000, outputFile: { file, maximumBytes: 3 } },
            )
            assert.equal(streamed.stdout.length, 0)
            assert.equal(streamed.artifact?.sha256, digest(Buffer.from('abc')))
        } finally {
            await file.close()
        }
    }))

test.skipIf(process.platform === 'win32')(
    'owned output and snapshots become exactly0600 under a restrictive child umask',
    () =>
        fixture(async (directory) => {
            await writeFile(join(directory, 'source'), 'fixture')
            const code = `
import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { snapshotBackupArtifact } from './scripts/backup/artifact-file.ts'
import { createMaintenanceCommands } from './scripts/backup/maintenance-commands.ts'
process.umask(0o777)
const directory = ${JSON.stringify(directory)}
await snapshotBackupArtifact(directory+'/source',directory+'/snapshot',{bytes:7,sha256:createHash('sha256').update('fixture').digest('hex')})
await createMaintenanceCommands({cwd:process.cwd(),operation:'backup'}).file([process.execPath,'--no-env-file','-e','process.stdout.write("fixture")'],directory+'/output','fixture output')
assert.equal((await stat(directory+'/snapshot')).mode&0o777,0o600)
assert.equal((await stat(directory+'/output')).mode&0o777,0o600)
`
            const child = Bun.spawn([process.execPath, '--no-env-file', '-e', code], {
                cwd,
                stdout: 'pipe',
                stderr: 'pipe',
            })
            const [exit, stderr] = await Promise.all([
                child.exited,
                new Response(child.stderr).text(),
            ])
            assert.equal(exit, 0, stderr)
        }),
)

test('file output cap, timeout and nonzero exit fail; command cleanup removes partial artifacts', () =>
    fixture(async (directory) => {
        const file = await open(join(directory, 'capped'), 'wx', 0o600)
        try {
            const result = await runMaintenanceProcess(
                [process.execPath, '--no-env-file', '-e', 'process.stdout.write("too large")'],
                { cwd, timeoutMs: 5000, outputFile: { file, maximumBytes: 2 } },
            )
            assert.equal(result.failed, true)
            assert.equal(result.artifact, undefined)
            assert.equal((await file.stat()).size, 0)
        } finally {
            await file.close()
        }
        for (const script of [
            'process.stdout.write("partial");process.exitCode=7',
            'process.stdout.write("partial");setInterval(()=>{},1000)',
        ]) {
            const path = join(directory, 'failed')
            await assert.rejects(
                createMaintenanceCommands({ cwd, operation: 'backup' }).file(
                    [process.execPath, '--no-env-file', '-e', script],
                    path,
                    'fixture failure',
                    100,
                ),
            )
            await assert.rejects(stat(path), /ENOENT/)
        }
    }))

test('process sink write failure stops the producer and returns no successful artifact', async () => {
    const file = {
        write: async () => {
            throw new Error('synthetic disk failure')
        },
    } as unknown as Parameters<typeof writeFileChunk>[0]
    const result = await runMaintenanceProcess(
        [
            process.execPath,
            '--no-env-file',
            '-e',
            'process.stdout.write("fixture");setInterval(()=>{},1000)',
        ],
        { cwd, timeoutMs: 5000, outputFile: { file, maximumBytes: 1000 } },
    )
    assert.equal(result.failed, true)
    assert.equal(result.stopped, true)
    assert.equal(result.artifact, undefined)
    assert.equal(result.stdout.length, 0)
})

async function sparseArchive(path: string, name: string, size: number) {
    const header = Buffer.alloc(512)
    header.write(name)
    header.write('0000600\0', 100)
    header.write(size.toString(8).padStart(11, '0') + '\0', 124)
    header.fill(32, 148, 156)
    header[156] = 48
    header.write(
        header
            .reduce((sum, byte) => sum + byte, 0)
            .toString(8)
            .padStart(6, '0') + '\0 ',
        148,
    )
    const file = await open(path, 'wx+', 0o600)
    await file.write(header)
    await file.truncate(512 + Math.ceil(size / 512) * 512 + 1024)
    return file
}

test('file TAR skips a sparse multi-GiB regular body and rejects metadata over each Core cap', () =>
    fixture(async (directory) => {
        const large = await sparseArchive(join(directory, 'large'), 'opaque-state', 4 * 1024 ** 3)
        try {
            const index = await validateStateArchiveFile(large, 'controller')
            assert.equal(index[0]!.size, 4 * 1024 ** 3)
            assert.equal(index[0]!.bodyOffset, 512)
            await validateControllerEncryptionFile(large, index, () => {
                throw new Error('unexpected decrypt')
            })
        } finally {
            await large.close()
        }
        for (const [name, size] of [
            ['certificate-metadata.json', 8 * 1024 ** 2 + 1],
            ['candidate.json', 256 * 1024 + 1],
            ['dns-connections.json', 1024 ** 2 + 1],
        ] as const) {
            const file = await sparseArchive(join(directory, name), name, size)
            try {
                await assert.rejects(
                    validateControllerEncryptionFile(
                        file,
                        await validateStateArchiveFile(file, 'controller'),
                        () => {},
                    ),
                    /metadata is too large/,
                )
            } finally {
                await file.close()
            }
            const limit = size - 1
            const atLimit = await sparseArchive(join(directory, name + '-at-cap'), name, limit)
            try {
                const body = Buffer.alloc(limit, 32)
                body.write(
                    name === 'dns-connections.json'
                        ? JSON.stringify({ version: 1, connections: [] })
                        : '{}',
                )
                await atLimit.write(body, 0, body.length, 512)
                await validateControllerEncryptionFile(
                    atLimit,
                    await validateStateArchiveFile(atLimit, 'controller'),
                    () => {
                        throw new Error('unexpected decrypt')
                    },
                )
            } finally {
                await atLimit.close()
            }
        }
    }))

// oxlint-disable no-await-in-loop -- Each isolated fixture exercises ordered publication failure steps.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
    link,
    mkdir,
    mkdtemp,
    readFile,
    rename,
    rm,
    stat,
    symlink,
    writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'bun:test'
import { parseBackupMetadata } from '../../../../../../scripts/backup/format.ts'
import {
    publishProductionBackup,
    verifyPublishedBackup,
} from '../../../../../../scripts/backup/publication.ts'

const root = resolve(import.meta.dir, '../../../../../..')
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

async function fixture(run: (directory: string) => Promise<void>) {
    await mkdir(join(root, 'tmp'), { recursive: true })
    const directory = await mkdtemp(join(root, 'tmp', 'backup-publication-'))
    try {
        await run(directory)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

async function staged(directory: string) {
    const staging = join(directory, 'staging')
    const canonical = join(directory, 'canonical')
    await mkdir(staging)
    const key = Buffer.from('A'.repeat(43) + '=\n')
    const dump = Buffer.from('synthetic postgres dump fixture')
    const archive = directoryArchive()
    await Promise.all([
        writeFile(join(staging, 'app-encryption-key'), key),
        writeFile(join(staging, 'postgres.dump'), dump),
        writeFile(join(staging, 'controller-state.tar'), archive),
        writeFile(join(staging, 'crowdsec-state.tar'), archive),
    ])
    const metadata = parseBackupMetadata({
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
    })
    return { staging, canonical, metadata }
}

test('publishes and verifies canonical artifacts with managed build metadata', () =>
    fixture(async (directory) => {
        const { staging, canonical, metadata } = await staged(directory)
        await publishProductionBackup(staging, canonical, metadata)
        await assert.rejects(stat(staging), /ENOENT/)
        const verified = await verifyPublishedBackup(canonical)
        assert.deepEqual(verified.metadata, metadata)
        const bytes = await readFile(join(canonical, 'metadata.json'))
        assert.equal(verified.metadataSha256, digest(bytes))
        assert.equal(
            verified.bytes,
            bytes.length +
                metadata.applicationEncryptionKey.bytes +
                metadata.postgres.bytes +
                metadata.controllerState.bytes +
                metadata.crowdSecState.bytes,
        )
        if (process.platform !== 'win32')
            assert.equal((await stat(join(canonical, 'metadata.json'))).mode & 0o777, 0o600)
    }))

test('published artifact digest tampering fails verification', () =>
    fixture(async (directory) => {
        const { staging, canonical, metadata } = await staged(directory)
        await writeFile(join(staging, 'metadata.json'), JSON.stringify(metadata), {
            flag: 'wx',
            mode: 0o600,
        })
        await rename(staging, canonical)
        const verified = await verifyPublishedBackup(canonical)
        assert.deepEqual(verified.metadata, metadata)
        assert.equal(
            verified.metadataSha256,
            digest(await readFile(join(canonical, 'metadata.json'))),
        )
        await writeFile(
            join(canonical, 'postgres.dump'),
            Buffer.alloc(metadata.postgres.bytes, 120),
        )
        await assert.rejects(verifyPublishedBackup(canonical), /checksum mismatch/)
    }))

test.skipIf(process.platform === 'win32')(
    'rejects symbolic links for every published artifact including metadata',
    () =>
        fixture(async (directory) => {
            const { staging, canonical, metadata } = await staged(directory)
            await writeFile(join(staging, 'metadata.json'), JSON.stringify(metadata), {
                flag: 'wx',
                mode: 0o600,
            })
            await rename(staging, canonical)
            for (const name of [
                'metadata.json',
                'postgres.dump',
                'app-encryption-key',
                'controller-state.tar',
                'crowdsec-state.tar',
            ]) {
                const target = join(directory, name + '.held')
                await rename(join(canonical, name), target)
                await symlink(target, join(canonical, name))
                await assert.rejects(verifyPublishedBackup(canonical))
                await rm(join(canonical, name))
                await rename(target, join(canonical, name))
            }
        }),
)

test('rejects hard-linked metadata and artifacts', () =>
    fixture(async (directory) => {
        const { staging, canonical, metadata } = await staged(directory)
        await writeFile(join(staging, 'metadata.json'), JSON.stringify(metadata), {
            flag: 'wx',
            mode: 0o600,
        })
        await rename(staging, canonical)
        for (const name of [
            'metadata.json',
            'postgres.dump',
            'app-encryption-key',
            'controller-state.tar',
            'crowdsec-state.tar',
        ]) {
            const alias = join(directory, name + '.alias')
            await link(join(canonical, name), alias)
            await assert.rejects(verifyPublishedBackup(canonical), /invalid backup artifact/)
            await rm(alias)
        }
    }))

test('failed staging validation never publishes a canonical backup', () =>
    fixture(async (directory) => {
        const { staging, canonical, metadata } = await staged(directory)
        await writeFile(join(staging, 'postgres.dump'), Buffer.alloc(metadata.postgres.bytes, 120))
        await assert.rejects(
            publishProductionBackup(staging, canonical, metadata),
            /checksum mismatch/,
        )
        await assert.rejects(stat(canonical), /ENOENT/)
        assert.ok((await stat(staging)).isDirectory())
        await assert.rejects(publishProductionBackup(staging, canonical, metadata), /EEXIST/)
    }))

test('canonical publication failure preserves existing destination and verified staging', () =>
    fixture(async (directory) => {
        const { staging, canonical, metadata } = await staged(directory)
        await mkdir(canonical)
        await writeFile(join(canonical, 'marker'), 'existing backup')
        await assert.rejects(
            publishProductionBackup(staging, canonical, metadata),
            (error: unknown) =>
                error instanceof Error &&
                'code' in error &&
                ['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(String(error.code)),
        )
        assert.equal(await readFile(join(canonical, 'marker'), 'utf8'), 'existing backup')
        assert.deepEqual((await verifyPublishedBackup(staging)).metadata, metadata)
    }))

test('metadata preserves legacy image provenance while strictly validating managed provenance', () =>
    fixture(async (directory) => {
        const { metadata } = await staged(directory)
        const legacy = {
            imageId: 'sha256:' + 'c'.repeat(64),
            revision: 'old-revision',
            version: null,
        }
        assert.deepEqual(parseBackupMetadata({ ...metadata, source: legacy }).source, legacy)
        assert.deepEqual(
            parseBackupMetadata({ ...metadata, source: { ...metadata.source, revision: null } })
                .source,
            { ...metadata.source, revision: null },
        )
        for (const source of [
            { imageId: null, revision: null, version: 'test' },
            { ...metadata.source, buildSha256: '../invalid' },
            { ...metadata.source, revision: 'not-a-full-revision' },
            { ...metadata.source, version: '' },
            { ...metadata.source, imageId: legacy.imageId },
        ])
            assert.throws(
                () => parseBackupMetadata({ ...metadata, source }),
                /unsupported or invalid backup metadata/,
            )
    }))

// oxlint-disable no-await-in-loop -- Verify and sync each bounded artifact before atomic publication.
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, rename, writeFile, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { parseBackupMetadata, validateStateArchiveFile } from './format.ts'
import { parseApplicationEncryptionKeyFile, readFileRange } from './artifact-file.ts'
import type { BackupMetadata } from './Types/format.types.ts'

async function regularFile(path: string, maximum: number, sync = false): Promise<FileHandle> {
    const flags = sync && process.platform === 'win32' ? constants.O_RDWR : constants.O_RDONLY
    const file = await open(path, flags | constants.O_NOFOLLOW)
    try {
        const info = await file.stat()
        if (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > maximum)
            throw new Error('invalid backup artifact')
        return file
    } catch (error) {
        await file.close()
        throw error
    }
}

export async function syncBackupDirectory(path: string): Promise<void> {
    if (process.platform === 'win32') return
    const directory = await open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
        await directory.sync()
    } finally {
        await directory.close()
    }
}

export async function verifyPublishedBackup(directory: string) {
    const metadataFile = await regularFile(join(directory, 'metadata.json'), 65_536)
    let bytes: Buffer
    try {
        bytes = await metadataFile.readFile()
    } finally {
        await metadataFile.close()
    }
    const metadata = parseBackupMetadata(JSON.parse(bytes.toString('utf8')))
    let totalBytes = bytes.length
    const artifacts = [
        ['app-encryption-key', metadata.applicationEncryptionKey],
        ['postgres.dump', metadata.postgres],
        ['controller-state.tar', metadata.controllerState],
        ['crowdsec-state.tar', metadata.crowdSecState],
    ] as const
    for (const [name, expected] of artifacts) {
        const file = await regularFile(join(directory, name), expected.bytes)
        try {
            if ((await file.stat()).size !== expected.bytes)
                throw new Error('backup artifact size mismatch')
            const hash = createHash('sha256')
            for (let offset = 0; offset < expected.bytes; offset += 65_536)
                hash.update(
                    await readFileRange(file, offset, Math.min(65_536, expected.bytes - offset)),
                )
            if (hash.digest('hex') !== expected.sha256)
                throw new Error('backup artifact checksum mismatch')
            if (name === 'app-encryption-key') await parseApplicationEncryptionKeyFile(file)
            if (name === 'controller-state.tar') await validateStateArchiveFile(file, 'controller')
            if (name === 'crowdsec-state.tar') await validateStateArchiveFile(file, 'crowdsec')
            totalBytes += expected.bytes
        } finally {
            await file.close()
        }
    }
    return {
        metadata,
        metadataSha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: totalBytes,
    }
}

export async function publishProductionBackup(
    stagingPath: string,
    finalPath: string,
    metadata: BackupMetadata,
): Promise<void> {
    parseBackupMetadata(metadata)
    await writeFile(join(stagingPath, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
    })
    await verifyPublishedBackup(stagingPath)
    for (const name of [
        'app-encryption-key',
        'postgres.dump',
        'controller-state.tar',
        'crowdsec-state.tar',
        'metadata.json',
    ]) {
        const file = await regularFile(join(stagingPath, name), 8 * 1024 ** 3, true)
        try {
            await file.sync()
        } finally {
            await file.close()
        }
    }
    await syncBackupDirectory(stagingPath)
    await rename(stagingPath, finalPath)
}

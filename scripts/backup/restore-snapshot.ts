// oxlint-disable no-await-in-loop -- Snapshot each bounded artifact before any target mutation.
import { createDecipheriv, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, open, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    parseBackupMetadata,
    validateControllerEncryptionFile,
    validateStateArchiveFile,
} from './format.ts'
import {
    parseApplicationEncryptionKeyFile,
    readFileRange,
    snapshotBackupArtifact,
} from './artifact-file.ts'

const stateArchiveName = 'controller-state.tar'

async function readBackupFile(path: string, maximumBytes: number): Promise<Buffer> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
        const info = await file.stat()
        if (!info.isFile() || info.size > maximumBytes) throw new Error('unsupported backup file')
        return await readFileRange(file, 0, info.size)
    } catch {
        throw new Error('backup file is missing, invalid or too large')
    } finally {
        await file.close()
    }
}

export async function snapshotProductionRestore(inputPath: string, snapshot: string) {
    const metadataBytes = await readBackupFile(join(inputPath, 'metadata.json'), 65_536)
    let metadataValue: unknown
    try {
        metadataValue = JSON.parse(metadataBytes.toString('utf8'))
    } catch {
        throw new Error('invalid backup metadata')
    }
    const metadata = parseBackupMetadata(metadataValue)
    const backupId = createHash('sha256').update(metadataBytes).digest('hex')
    await writeFile(join(snapshot, 'metadata.json'), metadataBytes, { mode: 0o600, flag: 'wx' })
    await chmod(join(snapshot, 'metadata.json'), 0o600)
    const artifacts = [
        { name: 'postgres.dump', metadata: metadata.postgres },
        { name: 'app-encryption-key', metadata: metadata.applicationEncryptionKey },
        { name: stateArchiveName, metadata: metadata.controllerState },
        { name: 'crowdsec-state.tar', metadata: metadata.crowdSecState },
    ]
    for (const artifact of artifacts) {
        await snapshotBackupArtifact(
            join(inputPath, artifact.name),
            join(snapshot, artifact.name),
            artifact.metadata,
        )
    }
    const keyFile = await open(join(snapshot, 'app-encryption-key'), 'r')
    let appKey: Buffer
    try {
        appKey = await parseApplicationEncryptionKeyFile(keyFile)
    } finally {
        await keyFile.close()
    }
    const controllerFile = await open(join(snapshot, stateArchiveName), 'r')
    try {
        const controllerEntries = await validateStateArchiveFile(controllerFile, 'controller')
        await validateControllerEncryptionFile(
            controllerFile,
            controllerEntries,
            (ciphertext, iv, context) => {
                try {
                    if (iv.length !== 12 || ciphertext.length < 17)
                        throw new Error('invalid encrypted secret')
                    const decipher = createDecipheriv('aes-256-gcm', appKey, iv)
                    decipher.setAAD(Buffer.from(context, 'utf8'))
                    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16))
                    decipher.update(ciphertext.subarray(0, -16))
                    decipher.final()
                } catch {
                    throw new Error('backup application key cannot decrypt controller state')
                }
            },
        )
    } finally {
        await controllerFile.close()
    }
    const crowdSecFile = await open(join(snapshot, 'crowdsec-state.tar'), 'r')
    try {
        await validateStateArchiveFile(crowdSecFile, 'crowdsec')
    } finally {
        await crowdSecFile.close()
    }

    return { metadata, backupId }
}

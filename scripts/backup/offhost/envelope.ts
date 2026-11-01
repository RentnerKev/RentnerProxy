// oxlint-disable no-await-in-loop -- Stream bounded chunks and publish verified files in order.
import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto'
import { constants } from 'node:fs'
import {
    chmod,
    lstat,
    mkdir,
    mkdtemp,
    open,
    readdir,
    rename,
    rm,
    type FileHandle,
} from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import {
    parseApplicationEncryptionKeyFile,
    readFileRange,
    writeFileChunk,
} from '../artifact-file.ts'
import { syncBackupDirectory, verifyPublishedBackup } from '../publication.ts'

// v1 has a fixed 96-byte AAD header and exactly five concatenated artifact bodies,
// followed by the 16-byte GCM tag. No names or paths are accepted from the envelope.
const magic = Buffer.from('RPBAKENC', 'ascii')
const headerBytes = 96
const tagBytes = 16
const chunkBytes = 65_536
const names = [
    'metadata.json',
    'app-encryption-key',
    'postgres.dump',
    'controller-state.tar',
    'crowdsec-state.tar',
] as const
const limits = [65_536, 65_536, 8 * 1024 ** 3, 8 * 1024 ** 3, 8 * 1024 ** 3]
const maximumPayloadBytes = limits.reduce((sum, bytes) => sum + bytes, 0)

function parseRecoveryKey(value: string): Buffer {
    if (!/^[A-Za-z0-9+/]{43}=$/u.test(value))
        throw new Error('recovery key must be a canonical base64-encoded independent 32-byte key')
    const key = Buffer.from(value, 'base64')
    if (key.length !== 32 || key.toString('base64') !== value)
        throw new Error('recovery key must be a canonical base64-encoded independent 32-byte key')
    return key
}

export function createRecoveryKey(): string {
    const key = randomBytes(32)
    try {
        return key.toString('base64')
    } finally {
        key.fill(0)
    }
}

export function recoveryKeyId(value: string): string {
    const key = parseRecoveryKey(value)
    try {
        return createHash('sha256').update(key).digest('hex')
    } finally {
        key.fill(0)
    }
}

async function safeDirectory(directory: string): Promise<void> {
    let path = resolve(directory)
    while (true) {
        const info = await lstat(path)
        if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error('backup paths must not contain symbolic links or non-directories')
        const parent = dirname(path)
        if (parent === path) return
        path = parent
    }
}

async function absent(path: string): Promise<void> {
    try {
        await lstat(path)
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
        throw error
    }
    throw new Error('backup destination already exists')
}

async function regularFile(path: string, maximum: number): Promise<FileHandle> {
    const expected = await lstat(path)
    if (!expected.isFile() || expected.isSymbolicLink() || expected.nlink !== 1)
        throw new Error('invalid encrypted backup input')
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
        const info = await file.stat()
        if (
            !info.isFile() ||
            info.nlink !== 1 ||
            info.dev !== expected.dev ||
            info.ino !== expected.ino ||
            info.size < 1 ||
            info.size > maximum
        )
            throw new Error('invalid encrypted backup input size or file')
        return file
    } catch (error) {
        await file.close()
        throw error
    }
}

function payloadLengths(header: Buffer): number[] {
    if (
        !header.subarray(0, 8).equals(magic) ||
        header[8] !== 1 ||
        header[9] !== 1 ||
        header.readUInt16BE(10) !== 0
    )
        throw new Error('unsupported encrypted backup envelope')
    const lengths = limits.map((maximum, index) => {
        const bytes = header.readBigUInt64BE(56 + index * 8)
        if (bytes < 1n || bytes > BigInt(maximum))
            throw new Error('encrypted backup artifact exceeds size limit')
        return Number(bytes)
    })
    if (lengths.reduce((sum, bytes) => sum + bytes, 0) > maximumPayloadBytes)
        throw new Error('encrypted backup exceeds total size limit')
    return lengths
}

async function independentKey(file: FileHandle, key: Buffer, signal?: AbortSignal): Promise<void> {
    const applicationKey = await parseApplicationEncryptionKeyFile(file, signal)
    try {
        if (timingSafeEqual(applicationKey, key))
            throw new Error('recovery key must differ from the application encryption key')
    } finally {
        applicationKey.fill(0)
    }
}

export async function encryptBackup(
    directory: string,
    outputFile: string,
    recoveryKey: string,
    signal?: AbortSignal,
): Promise<{ bytes: number; sha256: string; keyId: string }> {
    signal?.throwIfAborted()
    const key = parseRecoveryKey(recoveryKey)
    const files: FileHandle[] = []
    let output: FileHandle | undefined
    let ownsOutput = false
    try {
        await safeDirectory(directory)
        if (dirname(resolve(outputFile)) === resolve(directory))
            throw new Error('encrypted output must be outside the complete source backup directory')
        await safeDirectory(dirname(resolve(outputFile)))
        await absent(outputFile)
        const entries = await readdir(directory)
        if (
            entries.length !== names.length ||
            entries.some((name) => !names.some((expected) => expected === name))
        )
            throw new Error('backup must contain exactly the five complete backup artifact files')
        for (const [index, name] of names.entries()) {
            signal?.throwIfAborted()
            files.push(await regularFile(join(directory, name), limits[index]!))
        }
        const verified = await verifyPublishedBackup(directory, signal)
        await independentKey(files[1]!, key, signal)
        const lengths = await Promise.all(files.map(async (file) => (await file.stat()).size))
        const header = Buffer.alloc(headerBytes)
        magic.copy(header)
        header[8] = 1
        header[9] = 1 // AES-256-GCM with a full 128-bit authentication tag.
        randomBytes(12).copy(header, 12)
        const keyId = createHash('sha256').update(key).digest('hex')
        Buffer.from(keyId, 'hex').copy(header, 24)
        lengths.forEach((bytes, index) => header.writeBigUInt64BE(BigInt(bytes), 56 + index * 8))
        payloadLengths(header)
        const expected = [
            verified.metadataSha256,
            verified.metadata.applicationEncryptionKey.sha256,
            verified.metadata.postgres.sha256,
            verified.metadata.controllerState.sha256,
            verified.metadata.crowdSecState.sha256,
        ]
        const cipher = createCipheriv('aes-256-gcm', key, header.subarray(12, 24), {
            authTagLength: tagBytes,
        })
        cipher.setAAD(header)
        output = await open(outputFile, 'wx', 0o600)
        ownsOutput = true
        await output.chmod(0o600)
        const hash = createHash('sha256')
        let bytes = 0
        const write = async (chunk: Buffer) => {
            await writeFileChunk(output!, chunk)
            hash.update(chunk)
            bytes += chunk.length
        }
        await write(header)
        for (const [index, file] of files.entries()) {
            const artifactHash = createHash('sha256')
            for (let offset = 0; offset < lengths[index]!; offset += chunkBytes) {
                signal?.throwIfAborted()
                const chunk = await readFileRange(
                    file,
                    offset,
                    Math.min(chunkBytes, lengths[index]! - offset),
                )
                artifactHash.update(chunk)
                await write(cipher.update(chunk))
            }
            if (
                (await file.stat()).size !== lengths[index] ||
                artifactHash.digest('hex') !== expected[index]
            )
                throw new Error('backup changed during encryption')
        }
        await write(cipher.final())
        await write(cipher.getAuthTag())
        await output.sync()
        await output.close()
        output = undefined
        signal?.throwIfAborted()
        await syncBackupDirectory(dirname(resolve(outputFile)))
        ownsOutput = false
        return { bytes, sha256: hash.digest('hex'), keyId }
    } finally {
        key.fill(0)
        await output?.close()
        await Promise.all(files.map((file) => file.close()))
        if (ownsOutput) await rm(outputFile, { force: true })
    }
}

export async function decryptBackup(
    inputFile: string,
    destinationDirectory: string,
    recoveryKey: string,
    signal?: AbortSignal,
): Promise<void> {
    signal?.throwIfAborted()
    const key = parseRecoveryKey(recoveryKey)
    let input: FileHandle | undefined
    let staging: string | undefined
    let ownsDestination = false
    try {
        await safeDirectory(dirname(resolve(inputFile)))
        const destination = resolve(destinationDirectory)
        if (destination === parse(destination).root) throw new Error('invalid backup destination')
        await safeDirectory(dirname(destination))
        await absent(destination)
        input = await regularFile(inputFile, headerBytes + maximumPayloadBytes + tagBytes)
        const header = await readFileRange(input, 0, headerBytes)
        const lengths = payloadLengths(header)
        const payloadBytes = lengths.reduce((sum, bytes) => sum + bytes, 0)
        if ((await input.stat()).size !== headerBytes + payloadBytes + tagBytes)
            throw new Error('truncated or trailing encrypted backup data')
        if (!timingSafeEqual(header.subarray(24, 56), createHash('sha256').update(key).digest()))
            throw new Error('encrypted backup recovery key does not match')
        const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(12, 24), {
            authTagLength: tagBytes,
        })
        decipher.setAAD(header)
        decipher.setAuthTag(await readFileRange(input, headerBytes + payloadBytes, tagBytes))
        staging = await mkdtemp(join(dirname(destination), '.rentnerproxy-decrypt-'))
        await chmod(staging, 0o700)
        let inputOffset = headerBytes
        for (const [index, name] of names.entries()) {
            const output = await open(join(staging, name), 'wx', 0o600)
            try {
                await output.chmod(0o600)
                for (let offset = 0; offset < lengths[index]!; offset += chunkBytes) {
                    signal?.throwIfAborted()
                    const bytes = Math.min(chunkBytes, lengths[index]! - offset)
                    await writeFileChunk(
                        output,
                        decipher.update(await readFileRange(input, inputOffset, bytes)),
                    )
                    inputOffset += bytes
                }
                await output.sync()
            } finally {
                await output.close()
            }
        }
        if ((await input.stat()).size !== headerBytes + payloadBytes + tagBytes)
            throw new Error('encrypted backup changed during decryption')
        if (decipher.final().length !== 0) throw new Error('invalid encrypted backup payload')
        signal?.throwIfAborted()
        await verifyPublishedBackup(staging, signal)
        const applicationKeyFile = await regularFile(
            join(staging, 'app-encryption-key'),
            limits[1]!,
        )
        try {
            await independentKey(applicationKeyFile, key, signal)
        } finally {
            await applicationKeyFile.close()
        }
        await syncBackupDirectory(staging)
        signal?.throwIfAborted()
        // mkdir is exclusive on every platform. Publish metadata last so partial moves
        // cannot be mistaken for a complete v4 backup; callers use it only on success.
        await mkdir(destination, { mode: 0o700 })
        ownsDestination = true
        await chmod(destination, 0o700)
        for (const name of [...names.slice(1), names[0]]) {
            signal?.throwIfAborted()
            await rename(join(staging, name), join(destination, name))
        }
        await syncBackupDirectory(destination)
        await syncBackupDirectory(dirname(destination))
        ownsDestination = false
    } finally {
        key.fill(0)
        await input?.close()
        if (staging) await rm(staging, { recursive: true, force: true })
        if (ownsDestination)
            await rm(resolve(destinationDirectory), { recursive: true, force: true })
    }
}

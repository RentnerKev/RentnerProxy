// oxlint-disable no-await-in-loop -- File offsets and writes must advance in order.
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, rm, type FileHandle } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'

export async function readFileRange(
    file: FileHandle,
    offset: number,
    size: number,
): Promise<Buffer> {
    const buffer = Buffer.alloc(size)
    let read = 0
    while (read < size) {
        const result = await file.read(buffer, read, size - read, offset + read)
        if (!result.bytesRead) throw new Error('truncated backup file')
        read += result.bytesRead
    }
    return buffer
}

export async function writeFileChunk(file: FileHandle, bytes: Uint8Array): Promise<void> {
    let offset = 0
    while (offset < bytes.length) {
        const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset)
        if (!bytesWritten) throw new Error('backup file write made no progress')
        offset += bytesWritten
    }
}

export async function snapshotBackupArtifact(
    source: string,
    target: string,
    expected: { bytes: number; sha256: string },
): Promise<void> {
    let input: FileHandle
    try {
        input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch {
        throw new Error('backup file is missing, invalid or too large')
    }
    try {
        await snapshotBackupArtifactFile(input, target, expected)
    } finally {
        await input.close()
    }
}

export async function snapshotBackupArtifactFile(
    input: FileHandle,
    target: string,
    expected: { bytes: number; sha256: string },
): Promise<void> {
    let output: FileHandle | undefined
    try {
        const info = await input.stat()
        if (!info.isFile() || info.size !== expected.bytes)
            throw new Error('backup artifact size mismatch')
        output = await open(target, 'wx', 0o600)
        await output.chmod(0o600)
        const hash = createHash('sha256')
        let offset = 0
        while (offset < expected.bytes) {
            const chunk = await readFileRange(
                input,
                offset,
                Math.min(65_536, expected.bytes - offset),
            )
            hash.update(chunk)
            await writeFileChunk(output, chunk)
            offset += chunk.length
        }
        const extra = Buffer.alloc(1)
        if (
            (await input.read(extra, 0, 1, offset)).bytesRead ||
            hash.digest('hex') !== expected.sha256
        )
            throw new Error('backup artifact checksum mismatch')
        await output.sync()
    } catch (error) {
        if (output) {
            await output.close()
            output = undefined
            await rm(target, { force: true })
        }
        throw error
    } finally {
        await output?.close()
    }
}

export async function parseApplicationEncryptionKeyFile(file: FileHandle): Promise<Buffer> {
    const decoder = new StringDecoder('utf8')
    let value = ''
    let trailingWhitespace = false
    const consume = (text: string) => {
        for (const character of text) {
            if (character.trim() === '') {
                if (value) trailingWhitespace = true
            } else {
                if (trailingWhitespace || value.length >= 44)
                    throw new Error('invalid backup application encryption key')
                value += character
            }
        }
    }
    const { size } = await file.stat()
    for (let offset = 0; offset < size; offset += 65_536)
        consume(decoder.write(await readFileRange(file, offset, Math.min(65_536, size - offset))))
    consume(decoder.end())
    const key = Buffer.from(value, 'base64')
    if (
        !/^[A-Za-z0-9+/]{43}=$/u.test(value) ||
        key.length !== 32 ||
        key.toString('base64') !== value
    )
        throw new Error('invalid backup application encryption key')
    return key
}

// oxlint-disable no-await-in-loop -- Snapshot and stream fixed artifacts in order with bounded reads.
import { createHash, randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { open, opendir, unlink, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { readFileRange, writeFileChunk } from '../../../scripts/backup/artifact-file.ts'
import { verifyPublishedBackup } from '../../../scripts/backup/publication.ts'
import type { ManagedBackupStatus } from '../../../web/src/lib/Backups/Types/backups.types.ts'
import { artifactsRoot, backupRoot } from './storage.ts'

const names = [
    'metadata.json',
    'app-encryption-key',
    'postgres.dump',
    'controller-state.tar',
    'crowdsec-state.tar',
] as const

export function backupTarHeader(name: (typeof names)[number], size: number): Buffer {
    if (!Number.isSafeInteger(size) || size < 0 || size >= 8 * 1024 ** 3)
        throw new Error('invalid tar size')
    const header = Buffer.alloc(512)
    header.write(name)
    header.write('0000600\0', 100)
    header.write('0000000\0', 108)
    header.write('0000000\0', 116)
    header.write(size.toString(8).padStart(11, '0') + '\0', 124)
    header.write('00000000000\0', 136)
    header.fill(32, 148, 156)
    header[156] = 48
    header.write('ustar\0', 257)
    header.write('00', 263)
    header.write(
        header
            .reduce((sum, byte) => sum + byte, 0)
            .toString(8)
            .padStart(6, '0') + '\0 ',
        148,
    )
    return header
}

function owned(info: Stats, directory = false) {
    return (
        (directory ? info.isDirectory() : info.isFile() && info.nlink === 1) &&
        info.uid === 0 &&
        (info.mode & 0o077) === 0
    )
}

function sameFile(before: Stats, after: Stats) {
    return (
        owned(after) &&
        before.dev === after.dev &&
        before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs
    )
}

class InvalidDownload extends Error {}

export function createBackupDownload(
    status: () => Promise<ManagedBackupStatus>,
    root = artifactsRoot,
    temporaryRoot = backupRoot,
) {
    let active = false
    return async (request: Request, id: string): Promise<Response> => {
        const headers = new Headers({
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        })
        const failure = (code: string, statusCode: number) =>
            Response.json({ error: code }, { status: statusCode, headers })
        if (id !== id.toLowerCase() || !z.uuid().safeParse(id).success)
            return failure('not_found', 404)
        if (active) return failure('conflict', 409)
        if (process.platform !== 'linux') return failure('unavailable', 503)
        active = true
        const stop = new AbortController()
        const abort = () => stop.abort()
        request.signal.addEventListener('abort', abort, { once: true })
        if (request.signal.aborted) abort()
        const timer = setTimeout(abort, 300_000)
        const files: FileHandle[] = []
        let archive: FileHandle | undefined
        let released = false
        const release = async () => {
            if (released) return
            released = true
            clearTimeout(timer)
            request.signal.removeEventListener('abort', abort)
            await Promise.all(files.map((file) => file.close().catch(() => {})))
            await archive?.close().catch(() => {})
            active = false
        }
        try {
            stop.signal.throwIfAborted()
            const job = (await status()).jobs.find((entry) => entry.id === id)
            if (!job || !job.retained) {
                await release()
                return failure('not_found', 404)
            }
            if (job.state !== 'succeeded' || job.artifact?.id !== id) throw new InvalidDownload()
            const directory = await open(
                join(root, id),
                constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
            )
            files.push(directory)
            if (!owned(await directory.stat(), true)) throw new InvalidDownload()
            const anchored = '/proc/self/fd/' + directory.fd
            let entries = 0
            for await (const entry of await opendir(anchored)) {
                if (++entries > names.length || !names.some((name) => name === entry.name))
                    throw new InvalidDownload()
            }
            if (entries !== names.length) throw new InvalidDownload()
            const inputs: { file: FileHandle; name: (typeof names)[number]; info: Stats }[] = []
            for (const name of names) {
                const file = await open(
                    join(anchored, name),
                    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
                )
                files.push(file)
                const info = await file.stat()
                if (!owned(info)) throw new InvalidDownload()
                inputs.push({ name, file, info })
            }
            let verified: Awaited<ReturnType<typeof verifyPublishedBackup>>
            try {
                verified = await verifyPublishedBackup(anchored, stop.signal)
            } catch (error) {
                if (error instanceof Error && 'code' in error) throw error
                throw new InvalidDownload()
            }
            stop.signal.throwIfAborted()
            if (
                verified.metadataSha256 !== job.artifact.metadataSha256 ||
                verified.bytes !== job.artifact.bytes ||
                JSON.stringify(verified.metadata.source) !== JSON.stringify(job.source)
            )
                throw new InvalidDownload()
            const temporary = join(temporaryRoot, '.download-' + randomUUID())
            archive = await open(temporary, 'wx+', 0o600)
            await unlink(temporary)
            const expected = [
                { bytes: inputs[0]!.info.size, sha256: verified.metadataSha256 },
                verified.metadata.applicationEncryptionKey,
                verified.metadata.postgres,
                verified.metadata.controllerState,
                verified.metadata.crowdSecState,
            ]
            for (const [index, input] of inputs.entries()) {
                const artifact = expected[index]!
                if (input.info.size !== artifact.bytes) throw new InvalidDownload()
                await writeFileChunk(archive, backupTarHeader(input.name, artifact.bytes))
                const hash = createHash('sha256')
                for (let offset = 0; offset < artifact.bytes; offset += 65_536) {
                    stop.signal.throwIfAborted()
                    const chunk = await readFileRange(
                        input.file,
                        offset,
                        Math.min(65_536, artifact.bytes - offset),
                    )
                    hash.update(chunk)
                    await writeFileChunk(archive, chunk)
                }
                if (
                    hash.digest('hex') !== artifact.sha256 ||
                    !sameFile(input.info, await input.file.stat())
                )
                    throw new InvalidDownload()
                await writeFileChunk(archive, Buffer.alloc((512 - (artifact.bytes % 512)) % 512))
            }
            await writeFileChunk(archive, Buffer.alloc(1024))
            stop.signal.throwIfAborted()
            const length = (await archive.stat()).size
            await Promise.all(files.splice(0).map((file) => file.close()))
            let offset = 0
            let controller: ReadableStreamDefaultController<Uint8Array> | undefined
            const abortStream = () => {
                controller?.error(new Error('download cancelled'))
                void release()
            }
            stop.signal.addEventListener('abort', abortStream, { once: true })
            const stream = new ReadableStream<Uint8Array>({
                start(value) {
                    controller = value
                },
                async pull(value) {
                    try {
                        stop.signal.throwIfAborted()
                        if (offset === length) {
                            value.close()
                            await release()
                            return
                        }
                        const chunk = await readFileRange(
                            archive!,
                            offset,
                            Math.min(65_536, length - offset),
                        )
                        offset += chunk.length
                        value.enqueue(chunk)
                        if (offset === length) {
                            value.close()
                            await release()
                        }
                    } catch {
                        value.error(new Error('download unavailable'))
                        await release()
                    }
                },
                cancel: release,
            })
            headers.set('Content-Type', 'application/x-tar')
            headers.set('Content-Length', String(length))
            headers.set(
                'Content-Disposition',
                `attachment; filename="rentnerproxy-backup-${id}.tar"`,
            )
            return new Response(stream, { headers })
        } catch (error) {
            await release()
            if (request.signal.aborted) return new Response(null, { status: 499, headers })
            const invalid =
                error instanceof InvalidDownload ||
                (error instanceof Error &&
                    'code' in error &&
                    ['ENOENT', 'ELOOP', 'ENOTDIR'].includes(String(error.code)))
            return failure(invalid ? 'conflict' : 'unavailable', invalid ? 409 : 503)
        }
    }
}

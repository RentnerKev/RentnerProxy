// oxlint-disable-next-line import/no-unassigned-import -- Uploaded SQLite files must stay server-side.
import '@tanstack/react-start/server-only'

import { createHash } from 'node:crypto'
import { lstat, mkdtemp, open, readdir, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NPM_IMPORT_MAX_BYTES, NpmSourceError } from './npm-source.ts'

const PREFIX = 'rentnerproxy-npm-'
const STALE_AGE_MS = 60 * 60 * 1_000

async function removeKnownFiles(directory: string): Promise<void> {
    const path = join(directory, 'source.sqlite')
    await unlink(path).catch(() => undefined)
    await unlink(`${path}-shm`).catch(() => undefined)
    await unlink(`${path}-wal`).catch(() => undefined)
    await rmdir(directory).catch(() => undefined)
}

export async function withNpmSqliteUpload<T>(
    request: Request,
    callback: (path: string, fingerprint: string) => Promise<T>,
): Promise<T> {
    const contentLength = request.headers.get('content-length')
    if (
        contentLength &&
        (!/^\d+$/u.test(contentLength) || Number(contentLength) > NPM_IMPORT_MAX_BYTES)
    ) {
        throw new NpmSourceError('source_limit')
    }
    if (!request.body) throw new NpmSourceError('invalid_source')
    const directory = await mkdtemp(join(tmpdir(), PREFIX))
    const path = join(directory, 'source.sqlite')
    try {
        const file = await open(path, 'wx', 0o600)
        const digest = createHash('sha256')
        let bytes = 0
        try {
            for await (const chunk of request.body) {
                bytes += chunk.byteLength
                if (bytes > NPM_IMPORT_MAX_BYTES) throw new NpmSourceError('source_limit')
                digest.update(chunk)
                let offset = 0
                while (offset < chunk.byteLength) {
                    // oxlint-disable-next-line no-await-in-loop -- A partial filesystem write must be completed before the next chunk.
                    const { bytesWritten } = await file.write(
                        chunk,
                        offset,
                        chunk.byteLength - offset,
                    )
                    if (bytesWritten <= 0) throw new NpmSourceError('invalid_source')
                    offset += bytesWritten
                }
            }
        } finally {
            await file.close()
        }
        if (bytes < 100) throw new NpmSourceError('invalid_source')
        return await callback(path, digest.digest('hex'))
    } finally {
        await removeKnownFiles(directory)
    }
}

export async function pruneStaleNpmImports(now = Date.now()): Promise<void> {
    const entries = await readdir(tmpdir(), { withFileTypes: true })
    for (const entry of entries) {
        if (
            !/^rentnerproxy-npm-[A-Za-z0-9]{6}$/u.test(entry.name) ||
            !entry.isDirectory() ||
            entry.isSymbolicLink()
        )
            continue
        const directory = join(tmpdir(), entry.name)
        // oxlint-disable-next-line no-await-in-loop -- Inspect each bounded temp directory before removing it.
        const metadata = await lstat(directory).catch(() => null)
        if (
            !metadata?.isDirectory() ||
            metadata.isSymbolicLink() ||
            now - metadata.mtimeMs < STALE_AGE_MS
        )
            continue
        // Only the three exact filenames written by this importer are removed.
        // oxlint-disable-next-line no-await-in-loop -- Cleanup stays sequential to limit filesystem pressure.
        await removeKnownFiles(directory)
    }
}

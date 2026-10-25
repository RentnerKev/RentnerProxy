import { cp, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import type { ApplianceCommand } from '../fixtures/Types/appliance-storage.types.ts'

export const HISTORICAL_COMPATIBILITY_CONFIG = 'web/src/config/compatibility.config.ts'

function historicalSpecifiers(source: string): string[] {
    return [...source.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)(['"])([^'"\r\n]+)\1/gu)].map(
        (match) => match[2]!,
    )
}

function approvedHistoricalPath(path: string): boolean {
    return (
        path === 'scripts/production-backup.ts' ||
        path === 'scripts/production-restore.ts' ||
        path === 'scripts/smoke/resources.ts' ||
        path === HISTORICAL_COMPATIBILITY_CONFIG ||
        path === 'web/src/lib/ApplicationVersion/backupCompatibility.ts' ||
        /^scripts\/backup\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.ts$/u.test(
            path,
        )
    )
}

export async function readHistoricalToolSource(
    command: ApplianceCommand,
    revision: string,
    path: string,
): Promise<string> {
    if (!/^[a-f0-9]{40}$/u.test(revision) || !approvedHistoricalPath(path))
        throw new Error('unsupported historical tool identity')
    const size = await command(['git', 'cat-file', '-s', `${revision}:${path}`])
    if (!/^\d+$/u.test(size) || Number(size) > 256 * 1024)
        throw new Error('historical tool closure exceeds byte limit')
    return command(['git', 'show', `${revision}:${path}`])
}

export async function loadHistoricalToolClosure(
    readSource: (path: string) => Promise<string>,
): Promise<ReadonlyMap<string, string>> {
    const files = new Map<string, string>()
    const pending = ['scripts/production-backup.ts', 'scripts/production-restore.ts']
    let totalBytes = 0
    while (pending.length > 0) {
        const path = pending.pop()!
        if (files.has(path)) continue
        if (!approvedHistoricalPath(path) || files.size >= 64)
            throw new Error('unsupported historical tool path or closure size')
        // oxlint-disable-next-line no-await-in-loop -- Traverse an exact-revision dependency closure with strict file and byte bounds.
        const source = await readSource(path)
        const bytes = Buffer.byteLength(source)
        totalBytes += bytes
        if (bytes > 256 * 1024 || totalBytes > 2 * 1024 * 1024)
            throw new Error('historical tool closure exceeds byte limit')
        files.set(path, source)
        for (const specifier of historicalSpecifiers(source)) {
            if (specifier.startsWith('node:') || specifier === 'bun' || specifier === 'zod')
                continue
            if (!specifier.startsWith('.')) throw new Error('unsupported historical tool import')
            const dependency = posix.normalize(posix.join(posix.dirname(path), specifier))
            if (!approvedHistoricalPath(dependency))
                throw new Error(`unsupported historical tool import in ${path}: ${specifier}`)
            pending.push(dependency)
        }
    }
    for (const [path, source] of files) assertHistoricalImports(source, path, [...files.keys()])
    return files
}

export function assertHistoricalImports(
    source: string,
    repositoryPath: string,
    availablePaths: readonly string[],
): void {
    for (const specifier of historicalSpecifiers(source)) {
        if (specifier.startsWith('node:') || specifier === 'bun' || specifier === 'zod') continue
        if (specifier.startsWith('.')) {
            const dependency = posix.normalize(posix.join(posix.dirname(repositoryPath), specifier))
            if (availablePaths.includes(dependency)) continue
        }
        throw new Error('unsupported historical tool import')
    }
}

export async function copyHistoricalZod(installedPackage: string, historicalRoot: string) {
    const metadata = JSON.parse(await readFile(join(installedPackage, 'package.json'), 'utf8')) as {
        readonly name?: unknown
    }
    if (metadata.name !== 'zod') throw new Error('historical Zod dependency unavailable')
    const destination = join(historicalRoot, 'node_modules', 'zod')
    await mkdir(dirname(destination), { recursive: true })
    await cp(installedPackage, destination, {
        recursive: true,
        dereference: true,
        force: false,
        errorOnExist: true,
    })
    return destination
}

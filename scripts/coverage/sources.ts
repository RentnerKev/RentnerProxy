import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { coverageSourceExclusions, coverageSourceRoots } from './coverage.config.ts'
import { instrumentCoverageSource } from './instrumentation.ts'
import type { CoverageMapData } from 'istanbul-lib-coverage'
import type { CoverageBaseline, ExcludedCoverageSource } from './Types/report.types.ts'

function sourceName(repositoryRoot: string, absolute: string): string {
    return relative(repositoryRoot, absolute).replaceAll('\\', '/')
}

async function collect(repositoryRoot: string, directory: string): Promise<string[]> {
    const info = await lstat(directory)
    if (info.isSymbolicLink()) {
        const filename = sourceName(repositoryRoot, directory)
        if (coverageSourceExclusions.some((rule) => rule.pattern.test(filename + '/'))) return []
        throw new Error('Coverage source symlinks are unsupported: ' + filename)
    }
    if (!info.isDirectory()) return [directory]
    const entries = await readdir(directory, { withFileTypes: true })
    const paths = await Promise.all(
        entries.map((entry) => {
            const path = join(directory, entry.name)
            return entry.isDirectory() || entry.isSymbolicLink()
                ? collect(repositoryRoot, path)
                : Promise.resolve([path])
        }),
    )
    return paths.flat()
}

async function sourcePaths(repositoryRoot: string): Promise<string[]> {
    return (
        await Promise.all(
            coverageSourceRoots.map((path) => collect(repositoryRoot, join(repositoryRoot, path))),
        )
    )
        .flat()
        .filter((path) => /\.tsx?$/u.test(path))
        .toSorted()
}

function sourceHash(source: string): string {
    return createHash('sha256').update(source).digest('hex')
}

export async function assertCoverageSourcesUnchanged(
    repositoryRoot: string,
    hashes: Record<string, string>,
): Promise<void> {
    const sources = (await sourcePaths(repositoryRoot)).filter(
        (path) =>
            !coverageSourceExclusions.some((rule) =>
                rule.pattern.test(sourceName(repositoryRoot, path)),
            ),
    )
    const filenames = sources.map((path) => sourceName(repositoryRoot, path))
    if (JSON.stringify(filenames) !== JSON.stringify(Object.keys(hashes).toSorted()))
        throw new Error('Coverage source inventory changed during the run.')
    const matches = await Promise.all(
        sources.map(async (path) => {
            const filename = sourceName(repositoryRoot, path)
            return sourceHash(await readFile(path, 'utf8')) === hashes[filename]
        }),
    )
    if (matches.some((match) => !match)) throw new Error('Coverage sources changed during the run.')
}

export async function createCoverageBaseline(
    repositoryRoot: string,
    cacheDirectory?: string,
): Promise<CoverageBaseline> {
    const sources = await sourcePaths(repositoryRoot)
    const records = await Promise.all(
        sources.map(async (absolute) => {
            const filename = sourceName(repositoryRoot, absolute)
            const exclusion = coverageSourceExclusions.find((rule) => rule.pattern.test(filename))
            if (exclusion) {
                return { filename, reason: exclusion.reason }
            }
            const source = await readFile(absolute, 'utf8')
            const hash = sourceHash(source)
            const { code, coverage } = instrumentCoverageSource(source, filename)
            if (
                Object.keys(coverage.statementMap).length === 0 &&
                Object.keys(coverage.fnMap).length === 0
            ) {
                return { filename, hash, reason: 'no executable statements or functions' }
            }
            if (cacheDirectory) {
                const destination = join(cacheDirectory, filename)
                await mkdir(dirname(destination), { recursive: true })
                await writeFile(destination, code)
            }
            return { filename, hash, coverage }
        }),
    )
    const baseline: CoverageMapData = {}
    const excluded: ExcludedCoverageSource[] = []
    const hashes: Record<string, string> = {}
    for (const record of records) {
        if (record.hash) hashes[record.filename] = record.hash
        if (record.coverage) baseline[record.filename] = record.coverage
        else excluded.push({ path: record.filename, reason: record.reason! })
    }
    return { baseline, excluded, hashes }
}

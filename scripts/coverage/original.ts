import { createCoverageMap } from '@vitest/istanbul-lib-coverage'
import type { CoverageMap, FileCoverageData, Range } from '@vitest/istanbul-lib-coverage'
import type { InputSourceMap } from '@vitest/istanbul-lib-instrument'
import { createSourceMapStore } from '@vitest/istanbul-lib-source-maps'
import type { MapStore } from '@vitest/istanbul-lib-source-maps'
import { isAbsolute, relative } from 'node:path'

function canonicalSource(repositoryRoot: string, filename: string): string {
    return (isAbsolute(filename) ? relative(repositoryRoot, filename) : filename).replaceAll(
        '\\',
        '/',
    )
}

function normalizeLocations(data: FileCoverageData, source: string): void {
    const lines = source.split(/\r\n|\r|\n/u)
    const ranges: Range[] = [
        ...Object.values(data.statementMap),
        ...Object.values(data.fnMap).flatMap((fn) => [fn.decl, fn.loc]),
        ...Object.values(data.branchMap).flatMap((branch) =>
            [branch.loc].concat(branch.locations).filter(
                (range) =>
                    // An implicit else branch has no original source location.
                    range.start.line !== undefined || range.end.line !== undefined,
            ),
        ),
    ]
    for (const range of ranges) {
        // Istanbul remapping uses Infinity for an original line's unknown end.
        // Use its actual UTF-16 length so JSON never turns that sentinel into null.
        if (range.end.column === Infinity)
            range.end.column = lines[range.end.line - 1]?.length ?? -1
        for (const point of [range.start, range.end]) {
            if (
                !Number.isSafeInteger(point.line) ||
                point.line < 1 ||
                point.line > lines.length ||
                !Number.isSafeInteger(point.column) ||
                point.column < 0 ||
                point.column > lines[point.line - 1]!.length
            )
                throw new Error('Invalid original coverage location: ' + data.path)
        }
    }
    for (const fn of Object.values(data.fnMap)) fn.line = fn.loc.start.line
}

async function preserveFunctions(
    store: MapStore,
    filename: string,
    raw: FileCoverageData,
    original: FileCoverageData,
    repositoryRoot: string,
): Promise<void> {
    const functions = await Promise.all(
        Object.entries(raw.fnMap).map(async ([id, fn]) => {
            const isolated = createCoverageMap({
                [filename]: {
                    path: filename,
                    statementMap: {},
                    fnMap: { [id]: fn },
                    branchMap: {},
                    s: {},
                    f: { [id]: raw.f[id]! },
                    b: {},
                },
            })
            const mapped = await store.transformCoverage(isolated)
            const [path] = mapped.files()
            if (
                mapped.files().length !== 1 ||
                !path ||
                canonicalSource(repositoryRoot, path) !== filename
            )
                throw new Error('Function source mapping changed the source inventory.')
            const candidates = Object.values(mapped.fileCoverageFor(path).fnMap)
            if (candidates.length !== 1) throw new Error('Function source mapping lost a function.')
            return { id, fn: candidates[0]!, hits: raw.f[id]! }
        }),
    )
    original.fnMap = Object.fromEntries(functions.map((fn) => [fn.id, fn.fn]))
    original.f = Object.fromEntries(functions.map((fn) => [fn.id, fn.hits]))
}

export async function remapTypescriptCoverage(
    raw: CoverageMap,
    sourceMaps: Record<string, InputSourceMap>,
    repositoryRoot: string,
): Promise<CoverageMap> {
    const files = raw.files().toSorted()
    if (JSON.stringify(files) !== JSON.stringify(Object.keys(sourceMaps).toSorted()))
        throw new Error('Coverage source map inventory differs.')
    const store = createSourceMapStore({ baseDir: repositoryRoot })
    try {
        for (const filename of files) {
            const sourceMap = sourceMaps[filename]!
            if (sourceMap.sources.length !== 1 || typeof sourceMap.sourcesContent?.[0] !== 'string')
                throw new Error('Coverage source map must retain the original source.')
            store.registerMap(filename, sourceMap)
            if (!store.getSourceMapSync(filename)) throw new Error('Invalid coverage source map.')
        }
        const mapped = await store.transformCoverage(raw)
        const result = createCoverageMap({})
        await Promise.all(
            mapped.files().map(async (path) => {
                const filename = canonicalSource(repositoryRoot, path)
                if (!files.includes(filename))
                    throw new Error('Unexpected remapped coverage source: ' + filename)
                const original = structuredClone(mapped.fileCoverageFor(path).toJSON())
                original.path = filename
                const before = raw.fileCoverageFor(filename).toSummary().functions
                const after = mapped.fileCoverageFor(path).toSummary().functions
                if (after.total > before.total)
                    throw new Error('Source mapping added coverage functions.')
                if (after.total < before.total) {
                    // Sparse maps can give nested arrows identical locations. Map
                    // those functions separately to preserve every raw counter ID.
                    await preserveFunctions(
                        store,
                        filename,
                        raw.fileCoverageFor(filename).toJSON(),
                        original,
                        repositoryRoot,
                    )
                }
                normalizeLocations(original, sourceMaps[filename]!.sourcesContent![0]!)
                result.addFileCoverage(original)
                const final = result.fileCoverageFor(filename).toSummary().functions
                if (final.total !== before.total || final.covered !== before.covered)
                    throw new Error('Source mapping changed function coverage counts.')
            }),
        )
        if (JSON.stringify(result.files().toSorted()) !== JSON.stringify(files))
            throw new Error('Source mapping lost coverage sources.')
        return result
    } finally {
        store.dispose()
    }
}

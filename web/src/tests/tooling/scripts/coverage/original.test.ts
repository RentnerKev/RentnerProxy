import { describe, expect, test } from 'bun:test'
import { createCoverageMap } from '@vitest/istanbul-lib-coverage'
import type { CoverageMapData } from '@vitest/istanbul-lib-coverage'
import { fileURLToPath } from 'node:url'
import { instrumentCoverageSource } from '../../../../../../scripts/coverage/instrumentation.ts'
import { remapTypescriptCoverage } from '../../../../../../scripts/coverage/original.ts'

const repositoryRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))

async function executeFixture(source: string, filename: string, calls: string) {
    const instrumented = instrumentCoverageSource(source, filename)
    const child = Bun.spawn(
        [
            process.execPath,
            '--no-env-file',
            '-e',
            `${instrumented.code}\n${calls}\nconsole.log(JSON.stringify(globalThis.rentnerproxyCoverage))`,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    expect({ status, stderr }).toEqual({ status: 0, stderr: '' })
    return {
        raw: createCoverageMap(JSON.parse(stdout) as CoverageMapData),
        sourceMaps: { [filename]: instrumented.sourceMap },
    }
}

describe('original TypeScript coverage mapping', () => {
    test('retains distinct nested function counters and never turns six of seven into full coverage', async () => {
        const filename = 'web/src/nested-coverage-fixture.ts'
        const fixture = await executeFixture(
            [
                'export const functions = [() => 1, () => 2, () => 3, () => 4, () => 5]',
                'export const nested = () => () => 9',
            ].join('\n'),
            filename,
            'for (const fn of functions) fn(); if (typeof nested() !== "function") throw new Error("Missing inner function")',
        )
        const before = JSON.stringify(fixture.raw)
        const functionIds = Object.keys(fixture.raw.fileCoverageFor(filename).fnMap)
        const mapped = await remapTypescriptCoverage(
            fixture.raw,
            fixture.sourceMaps,
            repositoryRoot,
        )
        const result = mapped.fileCoverageFor(filename)
        expect(result.toSummary().functions).toMatchObject({ total: 7, covered: 6, pct: 85.71 })
        expect(result.f[5]).toBe(1)
        expect(result.f[6]).toBe(0)
        expect(Object.keys(result.fnMap)).toEqual(functionIds)
        expect(JSON.stringify(fixture.raw)).toBe(before)
        expect(mapped.files()).toEqual([filename])
    })

    test('maps same-line Unicode arrows to original UTF-16 columns and finite JSON ranges', async () => {
        const filename = 'web/src/unicode-coverage-fixture.tsx'
        const line =
            'export const label: string = "Grüße 🦊"; export const arrows = [() => "ä", () => "🦊"]'
        const fixture = await executeFixture(
            `export type Label = string\n${line}\nexport const View = () => <span>hello</span>`,
            filename,
            'if (arrows[0]() !== "ä" || arrows[1]() !== "🦊") throw new Error("Unicode changed")',
        )
        const mapped = await remapTypescriptCoverage(
            fixture.raw,
            fixture.sourceMaps,
            repositoryRoot,
        )
        const result = mapped.fileCoverageFor(filename)
        const arrows = Object.values(result.fnMap).filter((fn) => fn.line === 2)
        expect(arrows.map((fn) => fn.loc.start.column)).toEqual([
            line.indexOf('"ä"'),
            line.lastIndexOf('"🦊"'),
        ])
        expect(result.toSummary().functions).toMatchObject({ total: 3, covered: 2 })
        const json = JSON.stringify(result.toJSON())
        expect(json).not.toContain('null')
        expect(
            Object.values(result.statementMap).every((range) => Number.isFinite(range.end.column)),
        ).toBe(true)
        expect(Object.values(result.fnMap).every((fn) => fn.line === fn.loc.start.line)).toBe(true)
    })

    test('keeps never-imported throwing code in the original zero-hit denominator', async () => {
        const filename = 'web/src/unimported-coverage-fixture.ts'
        const result = instrumentCoverageSource(
            'throw new Error("Must never execute"); export const never = () => 1',
            filename,
        )
        const raw = createCoverageMap({ [filename]: result.coverage })
        const mapped = await remapTypescriptCoverage(
            raw,
            { [filename]: result.sourceMap },
            repositoryRoot,
        )
        expect(mapped.files()).toEqual([filename])
        expect(mapped.fileCoverageFor(filename).toSummary().functions).toMatchObject({
            total: 1,
            covered: 0,
            pct: 0,
        })
        expect(mapped.fileCoverageFor(filename).toSummary().lines).toMatchObject({
            total: 1,
            covered: 0,
            pct: 0,
        })
    })

    test('retains implicit else counters without inventing source coordinates', async () => {
        const filename = 'web/src/implicit-else-coverage-fixture.ts'
        const fixture = await executeFixture(
            'export function choose(value: number) { if (value > 0) return 1; return 0 }',
            filename,
            'if (choose(1) !== 1 || choose(0) !== 0) throw new Error("Conditional changed")',
        )
        const mapped = await remapTypescriptCoverage(
            fixture.raw,
            fixture.sourceMaps,
            repositoryRoot,
        )
        const result = mapped.fileCoverageFor(filename)
        expect(result.toSummary().branches).toEqual(
            fixture.raw.fileCoverageFor(filename).toSummary().branches,
        )
        expect(result.toSummary().functions).toMatchObject({ total: 1, covered: 1 })
        const branch = Object.values(result.branchMap).find((entry) => entry.type === 'if')!
        expect(branch.locations).toHaveLength(2)
        expect(Number.isSafeInteger(branch.loc.start.line)).toBe(true)
        expect(Number.isSafeInteger(branch.locations[0]!.end.column)).toBe(true)
        const rawBranch = Object.values(fixture.raw.fileCoverageFor(filename).branchMap).find(
            (entry) => entry.type === 'if',
        )!
        expect(branch.locations[1]).toEqual(rawBranch.locations[1])
    })

    test('fails closed when source-map inventory differs from coverage inventory', async () => {
        const result = instrumentCoverageSource(
            'export const value = () => 1',
            'web/src/inventory.ts',
        )
        const raw = createCoverageMap({ [result.coverage.path]: result.coverage })
        await Promise.all(
            [{}, { unexpected: result.sourceMap }].map((sourceMaps) =>
                expect(remapTypescriptCoverage(raw, sourceMaps, repositoryRoot)).rejects.toThrow(
                    'inventory differs',
                ),
            ),
        )
    })

    test('rejects missing original text, ambiguous sources, invalid maps and changed paths', async () => {
        const filename = 'web/src/invalid-map.ts'
        const result = instrumentCoverageSource('export const value = () => 1', filename)
        const raw = createCoverageMap({ [filename]: result.coverage })
        const missingContent = { ...result.sourceMap, sourcesContent: [] }
        const ambiguous = { ...result.sourceMap, sources: ['first.ts', 'second.ts'] }
        const changedPath = { ...result.sourceMap, sources: ['different.ts'] }
        const emptyMapping = { ...result.sourceMap, mappings: '' }
        await Promise.all(
            [missingContent, ambiguous, changedPath, emptyMapping].map((sourceMap) =>
                expect(
                    remapTypescriptCoverage(raw, { [filename]: sourceMap }, repositoryRoot),
                ).rejects.toThrow(),
            ),
        )
    })

    test('rejects remapped coordinates outside the retained original source', async () => {
        const filename = 'web/src/invalid-location.ts'
        const result = instrumentCoverageSource(
            'export type Value = number\nexport const value = () => 1',
            filename,
        )
        const raw = createCoverageMap({ [filename]: result.coverage })
        const sourceMap = { ...result.sourceMap, sourcesContent: [''] }
        await expect(
            remapTypescriptCoverage(raw, { [filename]: sourceMap }, repositoryRoot),
        ).rejects.toThrow('Invalid original coverage location')
    })
})

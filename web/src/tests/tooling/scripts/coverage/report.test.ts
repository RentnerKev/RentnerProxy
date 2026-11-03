import { describe, expect, test } from 'bun:test'
import type { CoverageMapData, FileCoverageData } from '@vitest/istanbul-lib-coverage'
import { instrumentCoverageSource } from '../../../../../../scripts/coverage/instrumentation.ts'
import {
    coverageCount,
    coverageFailures,
    formatCoverageResults,
    mergeTypescriptCoverage,
    typescriptCoverageResults,
} from '../../../../../../scripts/coverage/report.ts'
import { parseCoverageSummary } from '../../../../../../scripts/coverage/summary.ts'
import {
    goCoverageGroupNames,
    rustCoverageGroupNames,
    typescriptCoverageGroups,
} from '../../../../../../scripts/coverage/coverage.config.ts'
import type { CoverageProducer } from '../../../../../../scripts/coverage/Types/report.types.ts'

const text = 'export const alternatives = [() => 1, () => 2]; export const never = () => 3'
const filename = 'web/src/features/example.ts'
function data(path = filename): FileCoverageData {
    return instrumentCoverageSource(text, path).coverage
}

describe('coverage reports preserve the measured denominator', () => {
    test('unions distinct same-line functions across isolated snapshots and retains unimported zeroes', () => {
        const original = data()
        const first = structuredClone(original)
        const second = structuredClone(original)
        first.f[0] = 1
        second.f[1] = 1
        first.s[0] = 1
        const baseline: CoverageMapData = {
            [filename]: original,
            'unimported.ts': data('unimported.ts'),
        }
        const merged = mergeTypescriptCoverage(baseline, [
            { [filename]: first },
            { [filename]: second },
        ])
        expect(merged.fileCoverageFor(filename).toSummary().functions).toMatchObject({
            covered: 2,
            total: 3,
        })
        expect(merged.fileCoverageFor('unimported.ts').toSummary().functions).toMatchObject({
            covered: 0,
            total: 3,
        })
        expect(original.f).toEqual({ 0: 0, 1: 0, 2: 0 })
    })

    test('rejects absent measurements, foreign sources, stale maps and invalid counters', () => {
        const baseline = { [filename]: data() }
        expect(() => mergeTypescriptCoverage({}, [{}])).toThrow('missing')
        expect(() => mergeTypescriptCoverage(baseline, [])).toThrow('missing')
        expect(() => mergeTypescriptCoverage(baseline, [null])).toThrow('object')
        expect(() => mergeTypescriptCoverage(baseline, [{ other: data() }])).toThrow('Unexpected')
        const corruptions = [
            (value: FileCoverageData) => {
                value.path = 'other.ts'
            },
            (value: FileCoverageData) => {
                value.fnMap[0]!.loc.start.column += 1
            },
            (value: FileCoverageData) => {
                delete value.f[0]
            },
            (value: FileCoverageData) => {
                value.f[0] = -1
            },
            (value: FileCoverageData) => {
                value.f[0] = 0.5
            },
            (value: FileCoverageData) => {
                value.s[0] = Number.MAX_SAFE_INTEGER + 1
            },
            (value: FileCoverageData) => {
                value.b[42] = [1]
            },
        ]
        for (const corrupt of corruptions) {
            const snapshot = data()
            corrupt(snapshot)
            expect(() => mergeTypescriptCoverage(baseline, [{ [filename]: snapshot }])).toThrow()
        }
    })

    test('checks raw counts exactly rather than rounded percentages and distinguishes absent instrumentation', () => {
        expect(coverageFailures([{ name: 'exact', lines: coverageCount(9, 10) }])).toEqual([])
        const failures = coverageFailures([
            { name: 'rounded', lines: { ...coverageCount(89_999, 100_000), percent: 100 } },
        ])
        expect(failures).toHaveLength(1)
        expect(failures[0]).toContain('89999/100000 (89.9990%) < 90%')
        expect(coverageCount(0, 0).percent).toBeNull()
        expect(() => coverageFailures([{ name: 'empty', lines: coverageCount(0, 0) }])).toThrow()
        for (const [covered, total] of [
            [-1, 2],
            [3, 2],
            [0.5, 2],
            [1, Infinity],
        ])
            expect(() => coverageCount(covered!, total!)).toThrow()
        expect(() => coverageFailures([], 90)).toThrow()
        expect(() =>
            coverageFailures([{ name: 'valid', lines: coverageCount(1, 1) }], 90.5),
        ).toThrow()
        expect(
            formatCoverageResults([{ name: 'unmeasured', regions: coverageCount(0, 0) }]),
        ).toContain('| 0 | 0 | — |')
    })

    test('requires every configured thematic source group', () => {
        expect(() =>
            typescriptCoverageResults(mergeTypescriptCoverage({ [filename]: data() }, [{}])),
        ).toThrow('Missing coverage group')
    })
})

function summary(producer: CoverageProducer) {
    const names =
        producer === 'typescript'
            ? ['TypeScript overall', ...typescriptCoverageGroups.map((group) => group.name)]
            : producer === 'go'
              ? goCoverageGroupNames
              : rustCoverageGroupNames
    const metrics =
        producer === 'typescript'
            ? ['lines', 'functions']
            : producer === 'go'
              ? ['statements']
              : ['lines', 'functions', 'regions']
    return {
        version: 1,
        minimum: 90,
        testExitCode: 0,
        groups: names.map((name) =>
            Object.assign(
                { name },
                Object.fromEntries(
                    metrics.map((metric) => [metric, { covered: 9, total: 10, percent: 100 }]),
                ),
            ),
        ),
    }
}

describe('combined coverage requires successful complete producer reports', () => {
    test.each(['typescript', 'go', 'rust'] as const)(
        '%s requires all groups and metrics and recomputes percentages',
        (producer) => {
            const valid = summary(producer)
            const results = parseCoverageSummary(valid, producer)
            expect(results).toHaveLength(valid.groups.length)
            expect(Object.values(results[0]!).filter((value) => typeof value === 'object')).toEqual(
                Array.from({ length: Object.keys(valid.groups[0]!).length - 1 }, () =>
                    coverageCount(9, 10),
                ),
            )
            const missing = structuredClone(valid)
            missing.groups.pop()
            expect(() => parseCoverageSummary(missing, producer)).toThrow('missing')
            const duplicate = structuredClone(valid)
            duplicate.groups[1] = duplicate.groups[0]!
            expect(() => parseCoverageSummary(duplicate, producer)).toThrow('duplicate')
            expect(() =>
                parseCoverageSummary(
                    { ...valid, groups: [{ name: 'fake', lines: coverageCount(100, 100) }] },
                    producer,
                ),
            ).toThrow()
            expect(() => parseCoverageSummary({ ...valid, minimum: 80 }, producer)).toThrow()
            expect(() =>
                parseCoverageSummary(
                    { ...valid, groups: valid.groups.map((group) => ({ name: group.name })) },
                    producer,
                ),
            ).toThrow('metric')
            const empty = JSON.parse(
                JSON.stringify(valid)
                    .replaceAll('"total":10', '"total":0')
                    .replaceAll('"covered":9', '"covered":0'),
            ) as unknown
            expect(() => parseCoverageSummary(empty, producer)).toThrow('no instrumented code')
        },
    )

    test('rejects failed or missing TypeScript test exit status even with complete coverage', () => {
        const valid = summary('typescript')
        expect(() => parseCoverageSummary({ ...valid, testExitCode: 1 }, 'typescript')).toThrow(
            'tests failed',
        )
        expect(() =>
            parseCoverageSummary({ ...valid, testExitCode: undefined }, 'typescript'),
        ).toThrow('tests failed')
    })
})

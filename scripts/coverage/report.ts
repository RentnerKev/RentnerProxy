import { createCoverageMap } from '@vitest/istanbul-lib-coverage'
import type { CoverageMap, CoverageMapData, FileCoverageData } from '@vitest/istanbul-lib-coverage'
import { coverageThreshold, typescriptCoverageGroups } from './coverage.config.ts'
import type { CoverageCount, CoverageResult } from './Types/report.types.ts'

export function coverageCount(covered: number, total: number): CoverageCount {
    if (
        !Number.isSafeInteger(covered) ||
        !Number.isSafeInteger(total) ||
        covered < 0 ||
        total < covered
    ) {
        throw new Error('Invalid coverage counts.')
    }
    return { covered, total, percent: total === 0 ? null : (100 * covered) / total }
}

function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid coverage object.')
    return value as Record<string, unknown>
}

function checkCounters(value: unknown, expected: Record<string, number | number[]>): void {
    const actual = record(value)
    if (Object.keys(actual).toSorted().join(',') !== Object.keys(expected).toSorted().join(','))
        throw new Error('Coverage counter inventory differs.')
    for (const [key, shape] of Object.entries(expected)) {
        const values = Array.isArray(shape) ? actual[key] : [actual[key]]
        if (
            !Array.isArray(values) ||
            (Array.isArray(shape) && values.length !== shape.length) ||
            !values.every(
                (item) => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0,
            )
        ) {
            throw new Error('Invalid coverage counter.')
        }
    }
}

function validateSnapshot(
    value: unknown,
    expected: FileCoverageData,
): asserts value is FileCoverageData {
    const actual = record(value)
    if (actual.path !== expected.path) throw new Error('Coverage source path differs.')
    if ('inputSourceMap' in actual) throw new Error('Unexpected snapshot source map.')
    for (const field of ['statementMap', 'fnMap', 'branchMap'] as const) {
        if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field]))
            throw new Error('Coverage source maps differ; rerun with a fresh baseline.')
    }
    checkCounters(actual.s, expected.s)
    checkCounters(actual.f, expected.f)
    checkCounters(actual.b, expected.b)
}

export function mergeTypescriptCoverage(
    baseline: CoverageMapData,
    snapshots: unknown[],
): CoverageMap {
    if (Object.keys(baseline).length === 0 || snapshots.length === 0)
        throw new Error('Coverage baseline or test snapshots are missing.')
    const merged = createCoverageMap(structuredClone(baseline))
    for (const snapshot of snapshots) {
        for (const [filename, value] of Object.entries(record(snapshot))) {
            const expected = baseline[filename]
            if (!expected) throw new Error('Unexpected coverage source: ' + filename)
            validateSnapshot(value, 'toJSON' in expected ? expected.toJSON() : expected)
            merged.merge({ [filename]: value })
        }
    }
    return merged
}

function summarize(name: string, map: CoverageMap): CoverageResult {
    const summary = map.getCoverageSummary()
    return {
        name,
        lines: coverageCount(summary.lines.covered, summary.lines.total),
        functions: coverageCount(summary.functions.covered, summary.functions.total),
    }
}

export function typescriptCoverageResults(map: CoverageMap): CoverageResult[] {
    const results = [summarize('TypeScript overall', map)]
    for (const group of typescriptCoverageGroups) {
        const selected = createCoverageMap({})
        for (const filename of map.files().filter((path) => group.pattern.test(path)))
            selected.addFileCoverage(map.fileCoverageFor(filename))
        if (selected.files().length === 0) throw new Error('Missing coverage group: ' + group.name)
        results.push(summarize(group.name, selected))
    }
    return results
}

export function coverageFailures(results: CoverageResult[], minimum = coverageThreshold): string[] {
    if (results.length === 0 || !Number.isInteger(minimum) || minimum < 0 || minimum > 100)
        throw new Error('Invalid coverage gate.')
    for (const result of results) {
        if (
            ![result.lines, result.functions, result.regions, result.statements].some(
                (count) => count && count.total > 0,
            )
        )
            throw new Error('Coverage group has no instrumented code.')
    }
    return results.flatMap((result) =>
        Object.entries(result).flatMap(([metric, value]) => {
            if (metric === 'name' || value === undefined || typeof value === 'string') return []
            const count = coverageCount(value.covered, value.total)
            return count.total > 0 &&
                BigInt(count.covered) * 100n < BigInt(minimum) * BigInt(count.total)
                ? [
                      `${result.name}: ${metric} ${count.covered}/${count.total} (${count.percent!.toFixed(4)}%) < ${minimum}%`,
                  ]
                : []
        }),
    )
}

export function formatCoverageResults(results: CoverageResult[]): string {
    const metrics = ['lines', 'functions', 'regions', 'statements'] as const
    return (
        [
            '| Area | Metric | Covered | Total | Coverage |',
            '| --- | --- | ---: | ---: | ---: |',
            ...results.flatMap((result) =>
                metrics.flatMap((metric) => {
                    const count = result[metric]
                    return count
                        ? [
                              `| ${result.name} | ${metric} | ${count.covered} | ${count.total} | ${count.percent === null ? '—' : count.percent.toFixed(2) + '%'} |`,
                          ]
                        : []
                }),
            ),
        ].join('\n') + '\n'
    )
}

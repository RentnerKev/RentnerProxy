import type { CoverageMapData } from '@vitest/istanbul-lib-coverage'
import type { InputSourceMap } from '@vitest/istanbul-lib-instrument'

export type CoverageCount = { covered: number; total: number; percent: number | null }

export type CoverageResult = {
    name: string
    lines?: CoverageCount
    functions?: CoverageCount
    regions?: CoverageCount
    statements?: CoverageCount
}

export type ExcludedCoverageSource = { path: string; reason: string }

export type CoverageBaseline = {
    baseline: CoverageMapData
    excluded: ExcludedCoverageSource[]
    hashes: Record<string, string>
    sourceMaps: Record<string, InputSourceMap>
}

export type CoverageProducer = 'typescript' | 'go' | 'rust'

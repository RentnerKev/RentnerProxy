import type { CoverageMapData } from 'istanbul-lib-coverage'

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
}

export type CoverageProducer = 'typescript' | 'go' | 'rust'

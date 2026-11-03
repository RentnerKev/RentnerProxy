import type { FileCoverageData } from '@vitest/istanbul-lib-coverage'
import type { InputSourceMap } from '@vitest/istanbul-lib-instrument'

export type InstrumentedCoverageSource = {
    code: string
    coverage: FileCoverageData
    sourceMap: InputSourceMap
}

export type CoverageManifest = {
    repositoryRoot: string
    outputDirectory: string
    cacheDirectory: string
    files: string[]
}

export type CoverageCollectorState = {
    manifest: CoverageManifest
}

export type CoverageGlobal = typeof globalThis & {
    rentnerproxyCoverageCollector?: CoverageCollectorState
    rentnerproxyCoverage?: Record<string, FileCoverageData>
}

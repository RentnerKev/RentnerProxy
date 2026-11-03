import type { FileCoverageData } from 'istanbul-lib-coverage'

export type InstrumentedCoverageSource = {
    code: string
    coverage: FileCoverageData
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

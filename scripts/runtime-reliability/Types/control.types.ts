export type ReliabilityOptions = {
    source: 'current' | 'alpha.6'
    durationSeconds: number
    iterations: number
    concurrency: number
    captureResources: boolean
    seed: number
    image?: string
    reportPath?: string
}

export type ResourceSample = {
    elapsedSeconds: number
    phase: 'quiescent'
    memoryBytes: number
    cpuPercent: number
    pids: number
    postgresConnections: number
    webFds: number
    controllerFds: number
    caddyFds: number
    restartCount: number
    oomKilled: boolean
}

export type ReliabilityCheck = {
    name: 'health' | 'proxy' | 'revision' | 'restart' | 'reload' | 'rollback' | 'resources'
    passed: boolean
}

export type ReliabilityFailure = {
    stage: 'setup' | 'warmup' | 'cycle' | 'resources' | 'cleanup'
    category: 'assertion' | 'timeout' | 'command' | 'telemetry' | 'unexpected'
}

type KnownBaselineLimitation = 'alpha6-binding-retry-needs-second-request'

export type ReliabilityReportInput = {
    targetSha: string
    runtimeRevision: string
    imageIdentity: string
    options: ReliabilityOptions
    completedIterations: number
    observedDurationSeconds: number
    checks: ReliabilityCheck[]
    samples: ResourceSample[]
    failure?: ReliabilityFailure
    knownLimitations?: KnownBaselineLimitation[]
}

import type { resourceLimits, metrics } from '../control.config.ts'

export type ResourceMetric = (typeof metrics)[number]

export type ResourceAnalysis = {
    sampleCount: number
    trendEvidence: 'insufficient' | 'comparable'
    passed: boolean
    violations: (
        | 'oom'
        | 'restart'
        | 'memory-limit'
        | 'pid-limit'
        | 'connection-limit'
        | 'memory-growth'
        | 'connection-growth'
        | 'fd-growth'
        | 'telemetry-missing'
    )[]
    maxima: Record<ResourceMetric, number>
    headroom: typeof resourceLimits
    deltas: Partial<Record<ResourceMetric, number>>
}

import { resourceLimits, metrics } from './control.config.ts'
import type { ResourceMetric, ResourceAnalysis } from './Types/control.types.ts'
import type {
    ReliabilityOptions,
    ResourceSample,
    ReliabilityFailure,
    ReliabilityReportInput,
} from './Types/control.types.ts'

const profiles = {
    short: { durationSeconds: 120, iterations: 3 },
    long: { durationSeconds: 1800, iterations: 120 },
}

function boundedInteger(value: string, min: number, max: number): number {
    if (!/^\d+$/.test(value)) throw new Error('Invalid numeric option')
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number < min || number > max) {
        throw new Error('Numeric option outside allowed bounds')
    }
    return number
}

export function parseReliabilityOptions(args: string[]): ReliabilityOptions {
    const flags = new Map<string, string>()
    const allowed = new Set([
        '--profile',
        '--source',
        '--duration-seconds',
        '--iterations',
        '--concurrency',
        '--capture-resources',
        '--seed',
        '--image',
        '--report',
    ])
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index] ?? ''
        if (!allowed.has(flag)) throw new Error('Unknown reliability option')
        if (flags.has(flag)) throw new Error('Duplicate reliability option')
        const value = args[index + 1]
        if (!value || value.startsWith('--')) throw new Error('Missing reliability option value')
        flags.set(flag, value)
    }
    const profile = flags.get('--profile') ?? 'short'
    if (profile !== 'short' && profile !== 'long') throw new Error('Invalid reliability profile')
    const source = flags.get('--source') ?? 'current'
    if (source !== 'current' && source !== 'alpha.6') throw new Error('Invalid reliability source')
    const capture = flags.get('--capture-resources') ?? 'true'
    if (capture !== 'true' && capture !== 'false')
        throw new Error('Invalid resource capture option')
    const options: ReliabilityOptions = {
        source,
        durationSeconds: boundedInteger(
            flags.get('--duration-seconds') ?? String(profiles[profile].durationSeconds),
            30,
            7200,
        ),
        iterations: boundedInteger(
            flags.get('--iterations') ?? String(profiles[profile].iterations),
            1,
            1000,
        ),
        concurrency: boundedInteger(flags.get('--concurrency') ?? '2', 1, 8),
        captureResources: capture === 'true',
        seed: boundedInteger(flags.get('--seed') ?? '69', 0, 0xffffffff),
    }
    const image = flags.get('--image')
    if (image !== undefined) {
        if (image.length > 256 || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image)) {
            throw new Error('Invalid Docker image reference')
        }
        options.image = image
    }
    const reportPath = flags.get('--report')
    if (reportPath !== undefined) {
        if (
            reportPath.length > 4096 ||
            Array.from(reportPath).some((character) => character.charCodeAt(0) < 32)
        ) {
            throw new Error('Invalid report path')
        }
        options.reportPath = reportPath
    }
    return options
}

export function createSeededRandom(seed: number): () => number {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid seed')
    let state = seed
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let value = Math.imul(state ^ (state >>> 15), 1 | state)
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

export function shouldContinue(
    options: ReliabilityOptions,
    completedIterations: number,
    elapsedSeconds: number,
): boolean {
    return (
        Number.isInteger(completedIterations) &&
        completedIterations >= 0 &&
        Number.isFinite(elapsedSeconds) &&
        elapsedSeconds >= 0 &&
        completedIterations < options.iterations &&
        elapsedSeconds < options.durationSeconds
    )
}

function median(values: number[]): number {
    return values.toSorted((left, right) => left - right)[1] ?? 0
}

export function analyzeResources(samples: ResourceSample[], concurrency: number): ResourceAnalysis {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
        throw new Error('Invalid resource concurrency')
    let previousElapsed = -1
    for (const sample of samples) {
        if (
            sample.phase !== 'quiescent' ||
            typeof sample.oomKilled !== 'boolean' ||
            !Number.isFinite(sample.elapsedSeconds) ||
            sample.elapsedSeconds < 0 ||
            sample.elapsedSeconds < previousElapsed ||
            metrics.some(
                (metric) =>
                    !Number.isFinite(sample[metric]) ||
                    sample[metric] < 0 ||
                    (metric !== 'cpuPercent' && !Number.isInteger(sample[metric])),
            )
        ) {
            throw new Error('Invalid resource sample')
        }
        previousElapsed = sample.elapsedSeconds
    }
    const maxima = Object.fromEntries(
        metrics.map((metric) => [metric, Math.max(0, ...samples.map((sample) => sample[metric]))]),
    ) as Record<ResourceMetric, number>
    const violations: ResourceAnalysis['violations'] = []
    if (samples.length === 0) violations.push('telemetry-missing')
    if (samples.some((sample) => sample.oomKilled)) violations.push('oom')
    if (maxima.restartCount > 0) violations.push('restart')
    if (maxima.memoryBytes > resourceLimits.memoryBytes) violations.push('memory-limit')
    if (maxima.pids > resourceLimits.pids) violations.push('pid-limit')
    if (maxima.postgresConnections > resourceLimits.postgresConnections)
        violations.push('connection-limit')
    const deltas: ResourceAnalysis['deltas'] = {}
    const comparable =
        samples.length >= 8 &&
        samples.every(
            (sample, index) =>
                index === 0 || sample.elapsedSeconds > samples[index - 1]!.elapsedSeconds,
        )
    if (comparable) {
        for (const metric of metrics) {
            deltas[metric] =
                median(samples.slice(-3).map((sample) => sample[metric])) -
                median(samples.slice(0, 3).map((sample) => sample[metric]))
        }
        const allowance = 4 * concurrency + 16
        if (deltas.postgresConnections! > allowance) violations.push('connection-growth')
        if (
            ['webFds', 'controllerFds', 'caddyFds'].some(
                (metric) => deltas[metric as ResourceMetric]! > allowance,
            )
        )
            violations.push('fd-growth')
        const last = samples.slice(-3)
        if (
            deltas.memoryBytes! > resourceLimits.memoryBytes / 8 &&
            last[0]!.memoryBytes < last[1]!.memoryBytes &&
            last[1]!.memoryBytes < last[2]!.memoryBytes
        )
            violations.push('memory-growth')
    }
    return {
        sampleCount: samples.length,
        trendEvidence: comparable ? 'comparable' : 'insufficient',
        passed: violations.length === 0,
        violations,
        maxima,
        headroom: {
            memoryBytes: resourceLimits.memoryBytes - maxima.memoryBytes,
            pids: resourceLimits.pids - maxima.pids,
            postgresConnections: resourceLimits.postgresConnections - maxima.postgresConnections,
        },
        deltas,
    }
}

export function buildReliabilityReport(input: ReliabilityReportInput) {
    if (
        !/^[a-f0-9]{40}$/.test(input.targetSha) ||
        !/^[a-f0-9]{40}$/.test(input.runtimeRevision) ||
        !/^sha256:[a-f0-9]{64}$/.test(input.imageIdentity)
    )
        throw new Error('Invalid report identity')
    const options = parseReliabilityOptions([
        '--source',
        input.options.source,
        '--duration-seconds',
        String(input.options.durationSeconds),
        '--iterations',
        String(input.options.iterations),
        '--concurrency',
        String(input.options.concurrency),
        '--capture-resources',
        String(input.options.captureResources),
        '--seed',
        String(input.options.seed),
    ])
    if (
        !Number.isInteger(input.completedIterations) ||
        input.completedIterations < 0 ||
        input.completedIterations > options.iterations ||
        !Number.isFinite(input.observedDurationSeconds) ||
        input.observedDurationSeconds < 0
    )
        throw new Error('Invalid report progress')
    const checks = input.checks.map(({ name, passed }) => {
        if (
            !['health', 'proxy', 'revision', 'restart', 'reload', 'rollback', 'resources'].includes(
                name,
            ) ||
            typeof passed !== 'boolean'
        )
            throw new Error('Invalid report check')
        return { name, passed }
    })
    let failure: ReliabilityFailure | undefined
    if (input.failure) {
        const { stage, category } = input.failure
        if (
            !['setup', 'warmup', 'cycle', 'resources', 'cleanup'].includes(stage) ||
            !['assertion', 'timeout', 'command', 'telemetry', 'unexpected'].includes(category)
        )
            throw new Error('Invalid report failure')
        failure = { stage, category }
    }
    const knownLimitations = [...new Set(input.knownLimitations ?? [])]
    if (
        knownLimitations.some((value) => value !== 'alpha6-binding-retry-needs-second-request') ||
        (knownLimitations.length > 0 &&
            (options.source !== 'alpha.6' ||
                input.runtimeRevision !== 'c8a07cc413c1d9632d279e6d45cdf4d46f4947b1'))
    )
        throw new Error('Invalid baseline limitation')
    const resources = options.captureResources
        ? analyzeResources(input.samples, options.concurrency)
        : null
    return {
        schemaVersion: 1 as const,
        targetSha: input.targetSha,
        runtimeRevision: input.runtimeRevision,
        source: options.source,
        imageIdentity: input.imageIdentity,
        options,
        completedIterations: input.completedIterations,
        observedDurationSeconds: input.observedDurationSeconds,
        checks,
        resources,
        knownLimitations,
        summary: {
            passed:
                !failure &&
                input.completedIterations > 0 &&
                checks.length > 0 &&
                checks.every((check) => check.passed) &&
                (resources === null || resources.passed),
            stoppedBy:
                input.completedIterations >= options.iterations
                    ? 'iterations'
                    : input.observedDurationSeconds >= options.durationSeconds
                      ? 'duration'
                      : 'early',
            requestedDurationReached: input.observedDurationSeconds >= options.durationSeconds,
        },
        ...(failure ? { failure } : {}),
    }
}

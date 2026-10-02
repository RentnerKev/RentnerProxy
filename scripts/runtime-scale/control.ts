import { z } from 'zod'
import { analyzeResources, type ResourceSample } from '../runtime-reliability/control.ts'

export type ScaleOptions = {
    hosts: number
    concurrency: number
    rounds: number
    seed: number
    timeoutSeconds: number
    image?: string
    reportPath?: string
}

export type ScaleTraffic = {
    domain: string
    status: 200 | 404 | 302 | 307
    backend?: 'a' | 'b' | 'tls'
    location?: string
}

const countsSchema = z.strictObject({
    proxyHosts: z.number().int().nonnegative(),
    domains: z.number().int().nonnegative(),
    redirectHosts: z.number().int().nonnegative(),
    policies: z.number().int().nonnegative(),
    certificates: z.number().int().nonnegative(),
    trustedCas: z.number().int().nonnegative(),
    managementReads: z.number().int().nonnegative(),
    mutations: z.number().int().nonnegative(),
})
export type ScaleCounts = z.output<typeof countsSchema>

export const scaleResultSchema = z.object({
    desiredRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    counts: countsSchema,
    inventoryFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    traffic: z
        .array(
            z.object({
                domain: z
                    .string()
                    .min(1)
                    .max(253)
                    .regex(/^[a-z0-9.-]+$/u),
                status: z.union([z.literal(200), z.literal(404), z.literal(302), z.literal(307)]),
                backend: z.enum(['a', 'b', 'tls']).optional(),
                location: z.string().max(2048).optional(),
            }),
        )
        .max(1000),
    tlsHost: z
        .string()
        .max(253)
        .regex(/^[a-z0-9.-]+$/u)
        .optional(),
    certificateFingerprint: z
        .string()
        .regex(/^sha256:[a-f0-9]{64}$/u)
        .optional(),
    importRetryVerified: z.boolean().optional(),
})
export type ScaleResult = z.output<typeof scaleResultSchema>

export function parseScaleOptions(args: string[]): ScaleOptions {
    const flags = new Map<string, string>()
    const allowed = new Set([
        '--hosts',
        '--concurrency',
        '--rounds',
        '--seed',
        '--timeout-seconds',
        '--image',
        '--report',
    ])
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index] ?? ''
        const value = args[index + 1]
        if (!allowed.has(flag) || flags.has(flag)) throw new Error('Invalid scale option')
        if (!value || value.startsWith('--')) throw new Error('Missing scale option value')
        flags.set(flag, value)
    }
    const integer = (flag: string, fallback: number, maximum: number, minimum = 1): number => {
        const value = flags.get(flag) ?? String(fallback)
        if (!/^\d+$/u.test(value)) throw new Error('Invalid numeric scale option')
        const number = Number(value)
        if (!Number.isSafeInteger(number) || number < minimum || number > maximum)
            throw new Error('Scale option outside workload bounds')
        return number
    }
    const options: ScaleOptions = {
        hosts: integer('--hosts', 100, 100),
        concurrency: integer('--concurrency', 4, 8),
        rounds: integer('--rounds', 3, 5),
        seed: integer('--seed', 70, 0xffffffff, 0),
        timeoutSeconds: integer('--timeout-seconds', 600, 900, 30),
    }
    const image = flags.get('--image')
    if (image !== undefined) {
        if (image.length > 256 || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/u.test(image))
            throw new Error('Invalid scale image reference')
        options.image = image
    }
    const reportPath = flags.get('--report')
    if (reportPath !== undefined) {
        if (
            reportPath.length > 4096 ||
            [...reportPath].some((character) => character.charCodeAt(0) < 32)
        )
            throw new Error('Invalid scale report path')
        options.reportPath = reportPath
    }
    return options
}

export async function runBoundedTasks<T, U>(
    values: readonly T[],
    concurrency: number,
    operation: (value: T, index: number) => Promise<U>,
): Promise<U[]> {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
        throw new Error('Invalid scale concurrency')
    let next = 0
    let failed = false
    let failure: unknown
    const output: U[] = []
    const worker = async () => {
        while (!failed && next < values.length) {
            const index = next++
            try {
                // oxlint-disable-next-line no-await-in-loop -- Each worker admits one operation at a time.
                output[index] = await operation(values[index]!, index)
            } catch (error) {
                if (!failed) {
                    failed = true
                    failure = error
                }
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
    if (failed) throw failure
    return output
}

export async function drainConcurrent<T extends readonly unknown[]>(
    operations: T,
): Promise<{ -readonly [Key in keyof T]: Awaited<T[Key]> }> {
    const settled = await Promise.allSettled(operations)
    for (const result of settled) if (result.status === 'rejected') throw result.reason
    return Promise.all(operations)
}

const stages = [
    'setup',
    'warmup',
    'small',
    'large',
    'concurrent',
    'features',
    'interruption',
    'restart',
    'delete',
    'resources',
    'final',
    'cleanup',
] as const
export type ScaleStage = (typeof stages)[number]
export type ScaleMeasurement = {
    stage: ScaleStage
    elapsedMilliseconds: number
    counts: ScaleCounts
    desiredRevision: string
    inventoryFingerprint: string
}
export type ScaleResourceSample = { stage: ScaleStage; sample: ResourceSample }
type ScaleFailure = {
    stage: ScaleStage
    category: 'assertion' | 'timeout' | 'command' | 'telemetry' | 'unexpected'
}

export function buildScaleReport(input: {
    targetSha: string
    imageIdentity: string
    options: ScaleOptions
    elapsedSeconds: number
    measurements: ScaleMeasurement[]
    resources: ScaleResourceSample[]
    finalState?: { desiredRevision: string; activeRevision: string; inventoryFingerprint: string }
    checks: {
        name:
            | 'traffic'
            | 'revision'
            | 'management'
            | 'tls'
            | 'features'
            | 'restart'
            | 'interruption'
            | 'delete'
        passed: boolean
    }[]
    failure?: ScaleFailure
}) {
    const identity = z
        .strictObject({
            targetSha: z.string().regex(/^[a-f0-9]{40}$/u),
            imageIdentity: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            elapsedSeconds: z.number().finite().nonnegative(),
        })
        .parse({
            targetSha: input.targetSha,
            imageIdentity: input.imageIdentity,
            elapsedSeconds: input.elapsedSeconds,
        })
    const options = parseScaleOptions([
        '--hosts',
        String(input.options.hosts),
        '--concurrency',
        String(input.options.concurrency),
        '--rounds',
        String(input.options.rounds),
        '--seed',
        String(input.options.seed),
        '--timeout-seconds',
        String(input.options.timeoutSeconds),
    ])
    const revision = z.string().regex(/^sha256:[a-f0-9]{64}$/u)
    const measurements = input.measurements.map(
        ({ stage, elapsedMilliseconds, counts, desiredRevision, inventoryFingerprint }) =>
            z
                .strictObject({
                    stage: z.enum(stages),
                    elapsedMilliseconds: z.number().finite().nonnegative(),
                    counts: countsSchema,
                    desiredRevision: revision,
                    inventoryFingerprint: revision,
                })
                .parse({
                    stage,
                    elapsedMilliseconds,
                    counts,
                    desiredRevision,
                    inventoryFingerprint,
                }),
    )
    const finalState = input.finalState
        ? z
              .object({
                  desiredRevision: revision,
                  activeRevision: revision,
                  inventoryFingerprint: revision,
              })
              .parse(input.finalState)
        : undefined
    const resources = input.resources.map(({ stage, sample }) => {
        z.enum(stages).parse(stage)
        const analysis = analyzeResources([sample], options.concurrency)
        return { stage, observedSeconds: sample.elapsedSeconds, analysis }
    })
    const steadyStateResources = analyzeResources(
        input.resources.filter((entry) => entry.stage === 'final').map((entry) => entry.sample),
        options.concurrency,
    )
    const checks = input.checks.map(({ name, passed }) =>
        z
            .strictObject({
                name: z.enum([
                    'traffic',
                    'revision',
                    'management',
                    'tls',
                    'features',
                    'restart',
                    'interruption',
                    'delete',
                ]),
                passed: z.boolean(),
            })
            .parse({ name, passed }),
    )
    const failure = input.failure
        ? z
              .strictObject({
                  stage: z.enum(stages),
                  category: z.enum(['assertion', 'timeout', 'command', 'telemetry', 'unexpected']),
              })
              .parse({ stage: input.failure.stage, category: input.failure.category })
        : undefined
    const requiredChecks = [
        'traffic',
        'revision',
        'management',
        'tls',
        'features',
        'restart',
        'interruption',
        'delete',
    ]
    return {
        schemaVersion: 1,
        ...identity,
        options,
        measurements,
        resources,
        steadyStateResources,
        checks,
        ...(finalState ? { finalState } : {}),
        ...(failure ? { failure } : {}),
        summary: {
            passed:
                !failure &&
                finalState !== undefined &&
                finalState.desiredRevision === finalState.activeRevision &&
                measurements.at(-1)?.desiredRevision === finalState.desiredRevision &&
                measurements.at(-1)?.inventoryFingerprint === finalState.inventoryFingerprint &&
                measurements.some((entry) => entry.counts.proxyHosts >= options.hosts) &&
                requiredChecks.every((name) =>
                    checks.some((check) => check.name === name && check.passed),
                ) &&
                checks.every((check) => check.passed) &&
                resources.length > 0 &&
                resources.every((entry) => entry.analysis.passed) &&
                steadyStateResources.trendEvidence === 'comparable' &&
                steadyStateResources.passed,
            capacityGuarantee: false,
            longDurationEvidence: false,
        },
    }
}

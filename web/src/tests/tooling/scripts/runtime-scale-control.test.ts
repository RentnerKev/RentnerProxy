import { describe, expect, test } from 'bun:test'
import {
    buildScaleReport,
    drainConcurrent,
    parseScaleOptions,
    runBoundedTasks,
} from '../../../../../scripts/runtime-scale/control.ts'
import { scaleResultSchema } from '../../../../../scripts/runtime-scale/control.validation.ts'
import type { ScaleCounts } from '../../../../../scripts/runtime-scale/Types/control.types.ts'
import { resourceLimits } from '../../../../../scripts/runtime-reliability/control.config.ts'
import type { ResourceSample } from '../../../../../scripts/runtime-reliability/Types/control.types.ts'

const counts: ScaleCounts = {
    proxyHosts: 100,
    domains: 225,
    redirectHosts: 25,
    policies: 10,
    certificates: 1,
    trustedCas: 1,
    managementReads: 407,
    mutations: 328,
}
function sample(index: number, overrides: Partial<ResourceSample> = {}): ResourceSample {
    return {
        elapsedSeconds: index * 10,
        phase: 'quiescent',
        memoryBytes: 200 * 1024 ** 2,
        cpuPercent: 0,
        pids: 24,
        postgresConnections: 8,
        webFds: 32,
        controllerFds: 16,
        caddyFds: 20,
        restartCount: 0,
        oomKilled: false,
        ...overrides,
    }
}
function reportInput(): Parameters<typeof buildScaleReport>[0] {
    return {
        targetSha: 'a'.repeat(40),
        imageIdentity: 'sha256:' + 'b'.repeat(64),
        options: parseScaleOptions([]),
        elapsedSeconds: 70,
        measurements: [
            {
                stage: 'large',
                elapsedMilliseconds: 1000,
                counts: { ...counts },
                desiredRevision: 'sha256:' + 'c'.repeat(64),
                inventoryFingerprint: 'sha256:' + 'd'.repeat(64),
            },
        ],
        finalState: {
            desiredRevision: 'sha256:' + 'c'.repeat(64),
            activeRevision: 'sha256:' + 'c'.repeat(64),
            inventoryFingerprint: 'sha256:' + 'd'.repeat(64),
        },
        resources: Array.from({ length: 8 }, (_, index) => ({
            stage: 'final',
            sample: sample(index),
        })),
        checks: (
            [
                'traffic',
                'revision',
                'management',
                'tls',
                'features',
                'restart',
                'interruption',
                'delete',
            ] as const
        ).map((name) => ({ name, passed: true })),
    }
}
function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept
        reject = fail
    })
    return { promise, resolve, reject }
}

describe('runtime scale option bounds', () => {
    test('defaults and inclusive workload limits are explicit', () => {
        expect(parseScaleOptions([])).toEqual({
            hosts: 100,
            concurrency: 4,
            rounds: 3,
            seed: 70,
            timeoutSeconds: 600,
        })
        expect(
            parseScaleOptions([
                '--hosts',
                '1',
                '--concurrency',
                '1',
                '--rounds',
                '1',
                '--seed',
                '0',
                '--timeout-seconds',
                '30',
            ]),
        ).toEqual({ hosts: 1, concurrency: 1, rounds: 1, seed: 0, timeoutSeconds: 30 })
        expect(
            parseScaleOptions([
                '--hosts',
                '100',
                '--concurrency',
                '8',
                '--rounds',
                '5',
                '--seed',
                '4294967295',
                '--timeout-seconds',
                '900',
            ]),
        ).toEqual({ hosts: 100, concurrency: 8, rounds: 5, seed: 4294967295, timeoutSeconds: 900 })
        expect(
            parseScaleOptions([
                '--image',
                'ghcr.io/example/runtime@sha256:abcd',
                '--report',
                'C:\\test folder\\scale.json',
            ]),
        ).toMatchObject({
            image: 'ghcr.io/example/runtime@sha256:abcd',
            reportPath: 'C:\\test folder\\scale.json',
        })
    })
    test('rejects duplicates, malformed options and unsafe references without exposing input', () => {
        const invalid = [
            ['--token', 'private-secret'],
            ['--seed'],
            ['--seed', '--hosts', '1'],
            ['--seed', '1', '--seed', '2'],
            ['--hosts', '0'],
            ['--hosts', '101'],
            ['--concurrency', '0'],
            ['--concurrency', '9'],
            ['--rounds', '0'],
            ['--rounds', '6'],
            ['--timeout-seconds', '29'],
            ['--timeout-seconds', '901'],
            ['--seed', '-1'],
            ['--seed', '4294967296'],
            ['--seed', '1.0'],
            ['--seed', '1e2'],
            ['--seed', '0x10'],
            ['--seed', '9007199254740993'],
            ['--seed', 'private-secret'],
            ['--image', 'https://example.test?token=private-secret'],
            ['--image', 'private-secret\nimage'],
            ['--image', '-danger'],
            ['--image', 'a'.repeat(257)],
            ['--report', 'private-secret\u0000'],
            ['--report', 'a'.repeat(4097)],
        ]
        for (const args of invalid) {
            let errorMessage = ''
            try {
                parseScaleOptions(args)
            } catch (error) {
                errorMessage = error instanceof Error ? error.message : ''
            }
            expect(errorMessage.length).toBeGreaterThan(0)
            expect(errorMessage).not.toContain('private-secret')
        }
    })
})

describe('bounded scale task admission', () => {
    test('draining preserves ordered heterogeneous tuple values and their types', async () => {
        const values: [number, string, { ready: boolean }] = await drainConcurrent([
            Promise.resolve(7),
            Promise.resolve('complete'),
            { ready: true },
        ] as const)
        expect(values).toEqual([7, 'complete', { ready: true }])
        expect(await drainConcurrent([] as const)).toEqual([])
    })

    test('draining waits for all siblings and propagates the first input rejection', async () => {
        const gates = [deferred<number>(), deferred<string>(), deferred<boolean>()] as const
        const firstReason = new Error('first input rejected later')
        let settled = false
        const pending = drainConcurrent(gates.map((gate) => gate.promise)).then(
            () => {
                settled = true
                return { failed: false, reason: undefined }
            },
            (reason: unknown) => {
                settled = true
                return { failed: true, reason }
            },
        )
        gates[1].reject(new Error('second input rejected earlier'))
        await Promise.resolve()
        await Promise.resolve()
        expect(settled).toBe(false)
        gates[0].reject(firstReason)
        await Promise.resolve()
        await Promise.resolve()
        expect(settled).toBe(false)
        gates[2].resolve(true)
        const outcome = await pending
        expect(outcome.failed).toBe(true)
        expect(outcome.reason).toBe(firstReason)
    })

    test('caps live operations and returns input order despite reversed completion order', async () => {
        const gates = Array.from({ length: 4 }, () => deferred<number>())
        const started: number[] = []
        let active = 0
        let peak = 0
        const pending = runBoundedTasks([10, 20, 30, 40], 2, async (value, index) => {
            started.push(index)
            active += 1
            peak = Math.max(peak, active)
            await gates[index]!.promise
            active -= 1
            return value + index
        })
        expect(started).toEqual([0, 1])
        gates[1]!.resolve(0)
        await Promise.resolve()
        await Promise.resolve()
        expect(started).toEqual([0, 1, 2])
        gates[2]!.resolve(0)
        await Promise.resolve()
        await Promise.resolve()
        expect(started).toEqual([0, 1, 2, 3])
        gates[3]!.resolve(0)
        gates[0]!.resolve(0)
        expect(await pending).toEqual([10, 21, 32, 43])
        expect(peak).toBe(2)
        expect(active).toBe(0)
    })
    test('stops new admissions after failure and drains existing operations before rejecting', async () => {
        const gates = [deferred<number>(), deferred<number>()]
        const started: number[] = []
        const failure = new Error('operation failed')
        let settled = false
        const pending = runBoundedTasks([0, 1, 2, 3], 2, async (value) => {
            started.push(value)
            return gates[value]!.promise
        }).then(
            () => {
                settled = true
                return undefined
            },
            (error: unknown) => {
                settled = true
                return error
            },
        )
        gates[0]!.reject(failure)
        await Promise.resolve()
        await Promise.resolve()
        expect(settled).toBe(false)
        expect(started).toEqual([0, 1])
        gates[1]!.resolve(1)
        expect(await pending).toBe(failure)
        expect(started).toEqual([0, 1])
    })
    test('supports empty and small inputs and rejects unsupported worker counts', async () => {
        let calls = 0
        expect(
            await runBoundedTasks([], 8, async () => {
                calls += 1
            }),
        ).toEqual([])
        expect(calls).toBe(0)
        expect(await runBoundedTasks([7], 8, async (value) => value * 2)).toEqual([14])
        await Promise.all(
            [0, 9, 1.5, NaN, Infinity].map((concurrency) =>
                expect(runBoundedTasks([1], concurrency, async (value) => value)).rejects.toThrow(
                    'Invalid scale concurrency',
                ),
            ),
        )
    })

    test('preserves first null or undefined rejection while draining a later rejecting task', async () => {
        await Promise.all(
            [null, undefined].map(async (firstFailure) => {
                const gates = [deferred<number>(), deferred<number>()]
                const started: number[] = []
                let settled = false
                const pending = runBoundedTasks([0, 1, 2], 2, async (value) => {
                    started.push(value)
                    return gates[value]!.promise
                }).then(
                    () => {
                        settled = true
                        return { failed: false, reason: undefined }
                    },
                    (reason: unknown) => {
                        settled = true
                        return { failed: true, reason }
                    },
                )
                gates[0]!.reject(firstFailure)
                await Promise.resolve()
                await Promise.resolve()
                expect(settled).toBe(false)
                expect(started).toEqual([0, 1])
                gates[1]!.reject(new Error('later failure'))
                const outcome = await pending
                expect(outcome.failed).toBe(true)
                expect(outcome.reason).toBe(firstFailure)
                expect(started).toEqual([0, 1])
            }),
        )
    })
})

describe('scale report evidence and privacy', () => {
    test('requires all independent checks and observed target size, with bounded claims', () => {
        const complete = buildScaleReport(reportInput())
        expect(complete.summary).toEqual({
            passed: true,
            capacityGuarantee: false,
            longDurationEvidence: false,
        })
        expect(complete.steadyStateResources.trendEvidence).toBe('comparable')
        expect(complete.steadyStateResources.sampleCount).toBe(8)
        for (const check of reportInput().checks) {
            const missing = reportInput()
            missing.checks = missing.checks.filter((entry) => entry.name !== check.name)
            expect(buildScaleReport(missing).summary.passed).toBe(false)
            const failed = reportInput()
            failed.checks = failed.checks.map((entry) =>
                entry.name === check.name ? { ...entry, passed: false } : entry,
            )
            expect(buildScaleReport(failed).summary.passed).toBe(false)
        }
        const undersized = reportInput()
        undersized.measurements[0]!.counts.proxyHosts = 99
        expect(buildScaleReport(undersized).summary.passed).toBe(false)
        const noMeasurements = reportInput()
        noMeasurements.measurements = []
        expect(buildScaleReport(noMeasurements).summary.passed).toBe(false)
        const unmatched = reportInput()
        unmatched.finalState!.activeRevision = 'sha256:' + 'e'.repeat(64)
        expect(buildScaleReport(unmatched).summary.passed).toBe(false)
        const missingState = reportInput()
        delete missingState.finalState
        expect(buildScaleReport(missingState).summary.passed).toBe(false)
        const wrongInventory = reportInput()
        wrongInventory.finalState!.inventoryFingerprint = 'sha256:' + 'e'.repeat(64)
        expect(buildScaleReport(wrongInventory).summary.passed).toBe(false)
        const failed = reportInput()
        failed.failure = { stage: 'cleanup', category: 'command' }
        expect(buildScaleReport(failed).summary.passed).toBe(false)
    })
    test('only final samples establish stable trends and require eight distinct observation times', () => {
        const insufficient = reportInput()
        insufficient.resources.pop()
        expect(buildScaleReport(insufficient).summary.passed).toBe(false)
        const nonFinal = reportInput()
        nonFinal.resources = nonFinal.resources.map((entry) => ({ ...entry, stage: 'warmup' }))
        expect(buildScaleReport(nonFinal).steadyStateResources.trendEvidence).toBe('insufficient')
        expect(buildScaleReport(nonFinal).summary.passed).toBe(false)
        const sameInstant = reportInput()
        sameInstant.resources = sameInstant.resources.map((entry) => ({
            ...entry,
            sample: sample(0),
        }))
        expect(buildScaleReport(sameInstant).summary.passed).toBe(false)
        const duplicate = reportInput()
        duplicate.resources[4]!.sample.elapsedSeconds =
            duplicate.resources[3]!.sample.elapsedSeconds
        expect(buildScaleReport(duplicate).steadyStateResources.trendEvidence).toBe('insufficient')
        expect(buildScaleReport(duplicate).summary.passed).toBe(false)
        const missing = reportInput()
        missing.resources = []
        expect(buildScaleReport(missing).summary.passed).toBe(false)
    })
    test('hard bounds, retained growth and non-final resource failures prevent success', () => {
        for (const overrides of [
            { oomKilled: true },
            { restartCount: 1 },
            { memoryBytes: resourceLimits.memoryBytes + 1 },
            { pids: resourceLimits.pids + 1 },
            { postgresConnections: resourceLimits.postgresConnections + 1 },
        ]) {
            const input = reportInput()
            input.resources.unshift({ stage: 'small', sample: sample(0, overrides) })
            expect(buildScaleReport(input).summary.passed).toBe(false)
        }
        const growing = reportInput()
        growing.resources = growing.resources.map((entry, index) => ({
            ...entry,
            sample: sample(index, { webFds: 32 + index * 10 }),
        }))
        expect(buildScaleReport(growing).steadyStateResources.violations).toContain('fd-growth')
        expect(buildScaleReport(growing).summary.passed).toBe(false)
        const backwards = reportInput()
        backwards.resources[4]!.sample.elapsedSeconds = 1
        expect(() => buildScaleReport(backwards)).toThrow('Invalid resource sample')
        const invalid = reportInput()
        invalid.resources[0]!.sample.webFds = NaN
        expect(() => buildScaleReport(invalid)).toThrow('Invalid resource sample')
    })
    test('report allowlist drops private context and never stores image references or report paths', () => {
        const input = reportInput()
        input.options = {
            ...input.options,
            image: 'private-secret-image',
            reportPath: 'private-secret-path',
        }
        const privateInput = {
            ...input,
            token: 'private-secret',
            fixtureState: { session: 'private-secret' },
        }
        privateInput.resources = input.resources.map((entry) =>
            Object.assign({}, entry, {
                sample: { ...entry.sample, token: 'private-secret' },
            }),
        )
        const report = buildScaleReport(privateInput)
        expect(report.summary.passed).toBe(true)
        expect(JSON.stringify(report)).not.toContain('private-secret')
        expect(Object.keys(report.options).toSorted()).toEqual([
            'concurrency',
            'hosts',
            'rounds',
            'seed',
            'timeoutSeconds',
        ])
        expect(Object.keys(report.resources[0]!).toSorted()).toEqual([
            'analysis',
            'observedSeconds',
            'stage',
        ])
    })
    test('fixture output validates revisions, workload bounds and sanitized public fields', () => {
        const input = {
            desiredRevision: 'sha256:' + 'a'.repeat(64),
            inventoryFingerprint: 'sha256:' + 'b'.repeat(64),
            counts,
            traffic: [{ domain: 'h0.scale-example.test', status: 200, backend: 'a' }],
            session: 'private-secret',
        }
        expect(JSON.stringify(scaleResultSchema.parse(input))).not.toContain('private-secret')
        expect(
            scaleResultSchema.safeParse({ ...input, desiredRevision: 'private-secret' }).success,
        ).toBe(false)
        expect(
            scaleResultSchema.safeParse({ ...input, counts: { ...counts, proxyHosts: -1 } })
                .success,
        ).toBe(false)
        expect(
            scaleResultSchema.safeParse({
                ...input,
                traffic: [{ domain: 'private-secret\n', status: 200 }],
            }).success,
        ).toBe(false)
        expect(
            scaleResultSchema.safeParse({
                ...input,
                traffic: Array.from({ length: 1001 }, () => input.traffic[0]),
            }).success,
        ).toBe(false)
    })
})

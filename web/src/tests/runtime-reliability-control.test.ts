import { describe, expect, test } from 'bun:test'
import {
    analyzeResources,
    buildReliabilityReport,
    createSeededRandom,
    parseReliabilityOptions,
    resourceLimits,
    shouldContinue,
    type ReliabilityReportInput,
    type ResourceSample,
} from '../../../scripts/runtime-reliability/control.ts'

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

function sequence(seed: number): number[] {
    const random = createSeededRandom(seed)
    return Array.from({ length: 40 }, () => random())
}
function reportInput(): ReliabilityReportInput {
    return {
        targetSha: 'a'.repeat(40),
        runtimeRevision: 'c'.repeat(40),
        imageIdentity: `sha256:${'b'.repeat(64)}`,
        options: parseReliabilityOptions([]),
        completedIterations: 3,
        observedDurationSeconds: 25,
        checks: [{ name: 'health', passed: true }],
        samples: Array.from({ length: 8 }, (_, index) => sample(index)),
    }
}

describe('runtime reliability options', () => {
    test('explicit limits override either profile independent of argument order', () => {
        for (const args of [
            ['--iterations', '7', '--profile', 'long'],
            ['--profile', 'long', '--iterations', '7'],
        ]) {
            expect(parseReliabilityOptions(args)).toMatchObject({
                source: 'current',
                durationSeconds: 1800,
                iterations: 7,
                concurrency: 2,
                captureResources: true,
            })
        }
        expect(parseReliabilityOptions([])).toMatchObject({ durationSeconds: 120, iterations: 3 })
        expect(
            parseReliabilityOptions([
                '--source',
                'alpha.6',
                '--seed',
                '0',
                '--capture-resources',
                'false',
            ]),
        ).toMatchObject({ source: 'alpha.6', seed: 0, captureResources: false })
    })

    test('rejects malformed, ambiguous and out-of-range options without reflecting input', () => {
        const invalid = [
            ['--password', 'private-secret'],
            ['--iterations'],
            ['--iterations', '--seed', '1'],
            ['--seed', '1', '--seed', '2'],
            ['--profile', 'private-secret'],
            ['--source', 'private-secret'],
            ['--capture-resources', '1'],
            ['--duration-seconds', '29'],
            ['--duration-seconds', '7201'],
            ['--iterations', '0'],
            ['--iterations', '1001'],
            ['--concurrency', '9'],
            ['--seed', '-1'],
            ['--seed', '4294967296'],
            ['--seed', '1e2'],
            ['--seed', '0x10'],
            ['--seed', '1.0'],
            ['--image', 'secret\nimage'],
            ['--image', 'https://host?token=private-secret'],
            ['--image', '-danger'],
            ['--image', 'a'.repeat(257)],
            ['--report', 'private-secret\u0000'],
        ]
        for (const args of invalid) {
            let message = ''
            try {
                parseReliabilityOptions(args)
            } catch (error) {
                message = error instanceof Error ? error.message : ''
            }
            expect(message.length).toBeGreaterThan(0)
            expect(message).not.toContain('private-secret')
        }
        expect(
            parseReliabilityOptions([
                '--image',
                'ghcr.io/example/runtime:alpha.6',
                '--report',
                'C:\\test folder\\report.json',
                '--seed',
                '4294967295',
            ]).seed,
        ).toBe(4294967295)
    })

    test('stops at either cap and rejects invalid progress', () => {
        const options = parseReliabilityOptions([])
        expect(shouldContinue(options, 2, 119.9)).toBe(true)
        expect(shouldContinue(options, 3, 10)).toBe(false)
        expect(shouldContinue(options, 0, 120)).toBe(false)
        for (const elapsed of [NaN, Infinity, -1])
            expect(shouldContinue(options, 0, elapsed)).toBe(false)
        expect(shouldContinue(options, -1, 0)).toBe(false)
        expect(shouldContinue(options, 0.5, 0)).toBe(false)
    })

    test('seeded workload repeats including zero seed without degenerating', () => {
        expect(sequence(0)).toEqual(sequence(0))
        expect(sequence(69)).toEqual(sequence(69))
        expect(sequence(0)).not.toEqual(sequence(69))
        expect(new Set(sequence(0)).size).toBe(40)
        expect(sequence(0).every((value) => value >= 0 && value < 1)).toBe(true)
    })
})

describe('quiescent resource evidence', () => {
    test('stable counters and zero usage remain valid with explicit headroom', () => {
        const stable = Array.from({ length: 8 }, (_, index) => sample(index))
        const result = analyzeResources(stable, 2)
        expect(result.passed).toBe(true)
        expect(result.trendEvidence).toBe('comparable')
        expect(result.deltas.webFds).toBe(0)
        expect(result.headroom.memoryBytes).toBe(
            resourceLimits.memoryBytes - stable[0]!.memoryBytes,
        )
        expect(
            analyzeResources(
                [sample(0, { memoryBytes: 0, pids: 0, postgresConnections: 0, webFds: 0 })],
                2,
            ).passed,
        ).toBe(true)
    })

    test('never claims trends from too few samples or one instant', () => {
        expect(analyzeResources([], 2).trendEvidence).toBe('insufficient')
        expect(analyzeResources([], 2).passed).toBe(false)
        expect(
            analyzeResources(
                Array.from({ length: 7 }, (_, index) => sample(index)),
                2,
            ).deltas,
        ).toEqual({})
        expect(
            analyzeResources(
                Array.from({ length: 8 }, () => sample(0)),
                2,
            ).trendEvidence,
        ).toBe('insufficient')
    })

    test('flags hard deployment bounds, OOM and unplanned restarts even without trend evidence', () => {
        const result = analyzeResources(
            [
                sample(0, {
                    memoryBytes: resourceLimits.memoryBytes + 1,
                    pids: 513,
                    postgresConnections: 101,
                    restartCount: 1,
                    oomKilled: true,
                }),
            ],
            2,
        )
        expect(result.passed).toBe(false)
        expect(result.violations).toEqual([
            'oom',
            'restart',
            'memory-limit',
            'pid-limit',
            'connection-limit',
        ])
        expect(
            analyzeResources(
                [
                    sample(0, {
                        memoryBytes: resourceLimits.memoryBytes,
                        pids: 512,
                        postgresConnections: 100,
                    }),
                ],
                2,
            ).passed,
        ).toBe(true)
    })

    test('flags sustained retained growth while tolerating fixture allowance and plateaued memory', () => {
        const growing = Array.from({ length: 8 }, (_, index) =>
            sample(index, {
                memoryBytes: 200 * 1024 ** 2 + index * 32 * 1024 ** 2,
                postgresConnections: 8 + index * 6,
                webFds: 32 + index * 6,
            }),
        )
        expect(analyzeResources(growing, 2).violations).toEqual([
            'connection-growth',
            'fd-growth',
            'memory-growth',
        ])
        const plateau = growing.map((entry, index) =>
            Object.assign({}, entry, {
                ...entry,
                memoryBytes: index >= 5 ? 450 * 1024 ** 2 : entry.memoryBytes,
                postgresConnections: 8,
                webFds: 32,
            }),
        )
        expect(analyzeResources(plateau, 2).violations).toEqual([])
        const boundary = Array.from({ length: 8 }, (_, index) =>
            sample(index, { webFds: index < 3 ? 32 : 56 }),
        )
        expect(analyzeResources(boundary, 2).passed).toBe(true)
    })

    test('median endpoints resist one warmup outlier and one final measurement spike', () => {
        const samples = Array.from({ length: 8 }, (_, index) => sample(index))
        samples[0]!.webFds = 1000
        samples[7]!.memoryBytes = 900 * 1024 ** 2
        expect(analyzeResources(samples, 2).violations).toEqual([])
    })

    test('rejects corrupt telemetry rather than silently treating it as zero', () => {
        for (const override of [
            { memoryBytes: NaN },
            { cpuPercent: Infinity },
            { webFds: -1 },
            { pids: 0.5 },
            { elapsedSeconds: -1 },
            { postgresConnections: NaN },
        ])
            expect(() => analyzeResources([sample(0, override)], 2)).toThrow(
                'Invalid resource sample',
            )
        expect(() => analyzeResources([sample(2), sample(1)], 2)).toThrow('Invalid resource sample')
        expect(() => analyzeResources([], 0)).toThrow('Invalid resource concurrency')
    })
})

describe('sanitized reliability reports', () => {
    test('baseline limitations are explicit and cannot excuse a current-build regression', () => {
        const input = reportInput()
        input.options.source = 'alpha.6'
        input.runtimeRevision = 'c8a07cc413c1d9632d279e6d45cdf4d46f4947b1'
        input.knownLimitations = ['alpha6-binding-retry-needs-second-request']
        expect(buildReliabilityReport(input).knownLimitations).toEqual(input.knownLimitations)
        input.options.source = 'current'
        expect(() => buildReliabilityReport(input)).toThrow('Invalid baseline limitation')
        input.options.source = 'alpha.6'
        input.runtimeRevision = 'a'.repeat(40)
        expect(() => buildReliabilityReport(input)).toThrow('Invalid baseline limitation')
        input.runtimeRevision = 'c8a07cc413c1d9632d279e6d45cdf4d46f4947b1'
        input.knownLimitations = ['private-secret' as never]
        expect(() => buildReliabilityReport(input)).toThrow('Invalid baseline limitation')
        expect(buildReliabilityReport(reportInput()).knownLimitations).toEqual([])
    })

    test('keeps only known facts and honestly records a short iteration-limited run', () => {
        const input = reportInput()
        Object.assign(input, { privateToken: 'private-secret' })
        Object.assign(input.options, { image: 'private-secret', reportPath: 'private-secret' })
        Object.assign(input.checks[0]!, { log: 'private-secret' })
        const report = buildReliabilityReport(input)
        expect(JSON.stringify(report)).not.toContain('private-secret')
        expect(report.summary).toEqual({
            passed: true,
            stoppedBy: 'iterations',
            requestedDurationReached: false,
        })
        expect(report.observedDurationSeconds).toBe(25)
        expect(report.targetSha).toBe('a'.repeat(40))
        expect(report.runtimeRevision).toBe('c'.repeat(40))
    })

    test('failure exposes static categories and never exception details', () => {
        const input = reportInput()
        input.failure = { stage: 'cycle', category: 'command' }
        Object.assign(input.failure, { message: 'private-secret', stderr: 'private-secret' })
        const report = buildReliabilityReport(input)
        expect(report.failure).toEqual({ stage: 'cycle', category: 'command' })
        expect(report.summary.passed).toBe(false)
        expect(JSON.stringify(report)).not.toContain('private-secret')
    })

    test('rejects arbitrary identity, check, failure and progress payloads', () => {
        const invalidInputs = [
            { ...reportInput(), targetSha: 'private-secret' },
            { ...reportInput(), runtimeRevision: 'private-secret' },
            { ...reportInput(), imageIdentity: 'registry/private-secret:latest' },
            { ...reportInput(), observedDurationSeconds: NaN },
            { ...reportInput(), completedIterations: 4 },
        ]
        for (const input of invalidInputs) expect(() => buildReliabilityReport(input)).toThrow()
        const input = reportInput()
        Object.assign(input.checks[0]!, { name: 'private-secret' })
        expect(() => buildReliabilityReport(input)).toThrow('Invalid report check')
        const failureInput = reportInput()
        failureInput.failure = { stage: 'cycle', category: 'command' }
        Object.assign(failureInput.failure, { category: 'private-secret' })
        expect(() => buildReliabilityReport(failureInput)).toThrow('Invalid report failure')
    })

    test('empty runs cannot claim success and resource failure reaches the summary', () => {
        expect(
            buildReliabilityReport({ ...reportInput(), completedIterations: 0 }).summary.passed,
        ).toBe(false)
        expect(buildReliabilityReport({ ...reportInput(), checks: [] }).summary.passed).toBe(false)
        expect(
            buildReliabilityReport({ ...reportInput(), samples: [sample(0, { oomKilled: true })] })
                .summary.passed,
        ).toBe(false)
    })
})

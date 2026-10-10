import { describe, expect, test } from 'bun:test'

import { runSteps } from '../../../../../../scripts/lib/command-runner.ts'
import type { CommandStep } from '../../../../../../scripts/lib/Types/command-runner.types.ts'
import { runCheck } from '../../../../../../scripts/check.ts'
import { createLogger } from '../../../../../../scripts/lib/logger.ts'

const sequence = {
    title: 'Running checks',
    doneMessage: 'All checks passed',
    steps: [
        { label: 'Format', script: 'format:check' },
        { label: 'TypeScript', script: 'typecheck' },
        { label: 'Tests', script: 'test:ts' },
    ],
} as const

function createOutputLogger(output: string[]) {
    return createLogger({ colors: false, write: (value) => output.push(value) })
}

describe('runSteps', () => {
    test('runs every step in order and reports completion', async () => {
        const output: string[] = []
        const executed: string[] = []

        const exitCode = await runSteps(sequence, {
            logger: createOutputLogger(output),
            runStep: async (step) => {
                executed.push(step.script)
                return 0
            },
        })

        expect(exitCode).toBe(0)
        expect(executed).toEqual(['format:check', 'typecheck', 'test:ts'])
        expect(output.at(-1)).toBe(' DONE  All checks passed\n')
    })

    test('stops at the first failure and preserves its exit code', async () => {
        const output: string[] = []
        const executed: CommandStep[] = []

        const exitCode = await runSteps(sequence, {
            logger: createOutputLogger(output),
            runStep: async (step) => {
                executed.push(step)
                return step.script === 'typecheck' ? 7 : 0
            },
        })

        expect(exitCode).toBe(7)
        expect(executed.map((step) => step.script)).toEqual(['format:check', 'typecheck'])
        expect(output).toContain('\u258C \u{10102} TypeScript failed\n')
        expect(output.some((line) => line.includes('All checks passed'))).toBeFalse()
    })

    test('returns one when a command cannot be started', async () => {
        const output: string[] = []

        const exitCode = await runSteps(sequence, {
            logger: createOutputLogger(output),
            runStep: () => {
                throw new Error('command unavailable')
            },
        })

        expect(exitCode).toBe(1)
        expect(output).toContain(' FAIL  Format failed to start: command unavailable\n')
    })
})

describe('check modes', () => {
    test('ordinary checks finish without database setup, builds or duplicate Rust checks', async () => {
        const executed: string[] = []
        const output: string[] = []
        expect(
            await runCheck([], {
                logger: createOutputLogger(output),
                runStep: async (step) => {
                    executed.push(step.script)
                    return 0
                },
            }),
        ).toBe(0)
        expect(executed).toContain('typecheck')
        expect(executed).toContain('test:ts')
        expect(
            executed.some((script) => /^(db:|build|rust:check|test:fuzz)/.test(script)),
        ).toBeFalse()
        expect(output.at(-1)).toBe(' DONE  All checks passed\n')
    })

    test('full checks build once and stop when fuzz fails before production builds', async () => {
        await Promise.all(
            [0, 7].map(async (fuzzExit) => {
                const executed: string[] = []
                const exitCode = await runCheck(['--full'], {
                    logger: createOutputLogger([]),
                    runStep: async (step) => {
                        executed.push(step.script)
                        return step.script === 'test:fuzz' ? fuzzExit : 0
                    },
                })
                expect(exitCode).toBe(fuzzExit)
                expect(executed).toContain('typecheck:scripts')
                expect(executed).not.toContain('typecheck')
                expect(executed.some((script) => script.startsWith('db:'))).toBeFalse()
                expect(executed.filter((script) => script === 'build:web')).toHaveLength(
                    fuzzExit ? 0 : 1,
                )
                expect(executed.filter((script) => script === 'build:core')).toHaveLength(
                    fuzzExit ? 0 : 1,
                )
            }),
        )
    })

    test('rejects unknown or repeated mode arguments before starting a command', () => {
        let started = false
        for (const args of [['--invalid'], ['--full', '--full']]) {
            expect(() =>
                runCheck(args, {
                    runStep: async () => {
                        started = true
                        return 0
                    },
                }),
            ).toThrow('Expected check or check --full')
        }
        expect(started).toBeFalse()
    })
})

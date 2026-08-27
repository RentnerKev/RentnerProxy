import { describe, expect, test } from 'bun:test'

import { buildSteps } from '../../../scripts/build'
import { runSteps, type CommandStep } from '../../../scripts/command-runner'
import { checkSteps } from '../../../scripts/check'
import { createLogger } from '../../../scripts/logger'

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

describe('script step definitions', () => {
  test('keeps build steps granular and appends them to checks without recursion', () => {
    expect(buildSteps.map((step) => step.script)).toEqual(['build:web', 'build:controller'])
    expect(checkSteps.slice(-buildSteps.length)).toEqual(buildSteps.slice())
    expect(
      checkSteps.some((step) => step.script === 'build' || step.script === 'check'),
    ).toBeFalse()
  })
})

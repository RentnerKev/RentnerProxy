import { buildSteps } from './build.ts'
import { runSteps } from './lib/command-runner.ts'
import type { CommandRunnerDependencies, CommandStep } from './lib/Types/command-runner.types.ts'

export const checkSteps: readonly CommandStep[] = [
    { label: 'Format', script: 'format:check' },
    { label: 'Oxlint', script: 'lint' },
    { label: 'Bun typecheck', script: 'typecheck' },
    { label: 'Bun tests', script: 'test:ts' },
    { label: 'Cargo clippy', script: 'rust:lint' },
    { label: 'Cargo tests', script: 'rust:test' },
]

export function runCheck(
    args: readonly string[] = [],
    dependencies: Partial<CommandRunnerDependencies> = {},
): Promise<number> {
    if (args.length > 1 || (args.length === 1 && args[0] !== '--full')) {
        throw new Error('Expected check or check --full')
    }
    const full = args[0] === '--full'
    const steps = full
        ? [
              ...checkSteps.map((step) =>
                  step.script === 'typecheck'
                      ? { label: 'Script typecheck', script: 'typecheck:scripts' }
                      : step,
              ),
              { label: 'Fuzz tests', script: 'test:fuzz' },
              ...buildSteps,
          ]
        : checkSteps

    return runSteps(
        {
            title: 'Running RentnerProxy checks',
            doneMessage: 'All checks passed',
            steps,
        },
        dependencies,
    )
}

if (import.meta.main) {
    process.exitCode = await runCheck(process.argv.slice(2))
}

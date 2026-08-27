import { buildSteps } from './build'
import { runSteps } from './command-runner'
import type { CommandRunnerDependencies, CommandStep } from './Types/command-runner.types'

export const checkSteps: readonly CommandStep[] = [
    { label: 'Format', script: 'format:check' },
    { label: 'Oxlint', script: 'lint' },
    { label: 'TypeScript', script: 'typecheck' },
    { label: 'Drizzle migrations', script: 'db:check' },
    { label: 'Bun tests', script: 'test:ts' },
    { label: 'Cargo check', script: 'rust:check' },
    { label: 'Cargo clippy', script: 'rust:lint' },
    { label: 'Cargo tests', script: 'rust:test' },
    ...buildSteps,
]

export function runCheck(dependencies: Partial<CommandRunnerDependencies> = {}): Promise<number> {
    return runSteps(
        {
            title: 'Running RentnerProxy checks',
            doneMessage: 'All checks passed',
            steps: checkSteps,
        },
        dependencies,
    )
}

if (import.meta.main) {
    process.exitCode = await runCheck()
}

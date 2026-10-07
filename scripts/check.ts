import { buildSteps } from './build.ts'
import { runSteps } from './lib/command-runner.ts'
import type { CommandRunnerDependencies, CommandStep } from './lib/Types/command-runner.types.ts'

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

function runCheck(dependencies: Partial<CommandRunnerDependencies> = {}): Promise<number> {
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

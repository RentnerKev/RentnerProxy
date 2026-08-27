import { buildSteps } from './build'
import { runSteps, type CommandRunnerDependencies, type CommandStep } from './command-runner'

export const checkSteps: readonly CommandStep[] = [
  { label: 'Format', script: 'format:check' },
  { label: 'Oxlint', script: 'lint' },
  { label: 'TypeScript', script: 'typecheck' },
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

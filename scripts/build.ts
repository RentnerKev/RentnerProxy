import { runSteps } from './command-runner'
import type { CommandRunnerDependencies, CommandStep } from './Types/command-runner.types'

export const buildSteps: readonly CommandStep[] = [
    { label: 'Web build', script: 'build:web' },
    { label: 'Controller build', script: 'build:controller' },
]

export function runBuild(dependencies: Partial<CommandRunnerDependencies> = {}): Promise<number> {
    return runSteps(
        {
            title: 'Building RentnerProxy',
            doneMessage: 'RentnerProxy build completed',
            steps: buildSteps,
        },
        dependencies,
    )
}

if (import.meta.main) {
    process.exitCode = await runBuild()
}

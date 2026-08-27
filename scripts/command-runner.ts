import { fileURLToPath } from 'node:url'

import { logger as defaultLogger } from './logger'
import type {
    CommandRunnerDependencies,
    CommandStep,
    StepSequence,
} from './Types/command-runner.types'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

async function runPackageScript(step: CommandStep): Promise<number> {
    const subprocess = Bun.spawn({
        cmd: [process.execPath, '--no-orphans', 'run', '--silent', step.script],
        cwd: repositoryRoot,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
    })

    return subprocess.exited
}

const defaultDependencies: CommandRunnerDependencies = {
    logger: defaultLogger,
    runStep: runPackageScript,
}

export async function runSteps(
    sequence: StepSequence,
    overrides: Partial<CommandRunnerDependencies> = {},
): Promise<number> {
    const dependencies = { ...defaultDependencies, ...overrides }

    dependencies.logger.info(sequence.title)

    async function runAt(index: number): Promise<number> {
        const step = sequence.steps[index]

        if (!step) {
            dependencies.logger.done(sequence.doneMessage)
            return 0
        }

        dependencies.logger.create(step.label)

        let exitCode: number

        try {
            exitCode = await dependencies.runStep(step)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            dependencies.logger.fail(`${step.label} failed to start: ${message}`)
            return 1
        }

        if (exitCode !== 0) {
            dependencies.logger.error(`${step.label} failed`)
            return exitCode
        }

        dependencies.logger.success(step.label)
        return runAt(index + 1)
    }

    return runAt(0)
}

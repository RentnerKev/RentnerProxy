import type { Logger } from './logger.types'

export interface CommandStep {
    readonly label: string
    readonly script: string
}

export interface StepSequence {
    readonly doneMessage: string
    readonly steps: readonly CommandStep[]
    readonly title: string
}

export interface CommandRunnerDependencies {
    readonly logger: Logger
    readonly runStep: (step: CommandStep) => Promise<number>
}

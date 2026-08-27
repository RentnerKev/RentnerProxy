import type { Logger } from './logger.types'

export type ShutdownSignal = 'SIGINT' | 'SIGTERM'

export interface ManagedProcess {
    readonly pid: number
    readonly exited: Promise<number>
    readonly exitCode: number | null
    readonly signalCode: NodeJS.Signals | null
    kill(signal?: number | NodeJS.Signals): void
}

export interface SpawnRequest {
    readonly command: string[]
    readonly cwd: string
    readonly detached: boolean
    readonly stderr: 'inherit'
    readonly stdin: 'inherit'
    readonly stdout: 'inherit'
}

export interface DevelopmentDependencies {
    readonly logger: Logger
    readonly offSignal: (signal: ShutdownSignal, handler: () => void) => void
    readonly onSignal: (signal: ShutdownSignal, handler: () => void) => void
    readonly platform: NodeJS.Platform
    readonly repositoryRoot: string
    readonly shutdownTimeoutMs: number
    readonly signalProcessTree: (childProcess: ManagedProcess, signal: NodeJS.Signals) => void
    readonly spawn: (request: SpawnRequest) => ManagedProcess
}

export interface ServiceDefinition {
    readonly label: string
    readonly script: 'dev:controller' | 'dev:web'
}

export interface RunningService extends ServiceDefinition {
    readonly process: ManagedProcess
}

export type DevelopmentEvent =
    | Readonly<{ kind: 'signal'; signal: ShutdownSignal }>
    | Readonly<{ kind: 'child-exit'; service: RunningService; exitCode: number }>

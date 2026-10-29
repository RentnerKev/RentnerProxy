import type { Logger } from '../../lib/Types/logger.types.ts'

export type ShutdownSignal = 'SIGINT' | 'SIGTERM'

export interface DevelopmentPort {
    readonly label: string
    readonly hostname: string
    readonly port: number
}

export interface ManagedProcess {
    readonly pid: number
    readonly exited: Promise<number>
    readonly exitCode: number | null
    readonly signalCode: NodeJS.Signals | number | null
    kill(signal?: number | NodeJS.Signals): void
}

export interface SpawnRequest {
    readonly command: string[]
    readonly cwd: string
    readonly env: NodeJS.ProcessEnv
    readonly detached: boolean
    readonly stderr: 'inherit'
    readonly stdin: 'inherit'
    readonly stdout: 'inherit'
}

export interface DevelopmentDependencies {
    readonly environment: NodeJS.ProcessEnv
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
    readonly script: 'dev:core' | 'dev:web'
}

export interface RunningService extends ServiceDefinition {
    readonly process: ManagedProcess
}

export type DevelopmentEvent =
    | Readonly<{ kind: 'signal'; signal: ShutdownSignal }>
    | Readonly<{ kind: 'child-exit'; service: RunningService; exitCode: number }>

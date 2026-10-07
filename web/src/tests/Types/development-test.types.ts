import type {
    DevelopmentDependencies,
    ShutdownSignal,
    SpawnRequest,
} from '../../../../scripts/development/Types/development.types.ts'

export interface DevelopmentHarness {
    readonly dependencies: Partial<DevelopmentDependencies>
    readonly handlers: Map<ShutdownSignal, () => void>
    readonly removedSignals: ShutdownSignal[]
    readonly requests: SpawnRequest[]
}

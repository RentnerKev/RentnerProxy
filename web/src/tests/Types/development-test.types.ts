import type {
    DevelopmentDependencies,
    ShutdownSignal,
    SpawnRequest,
} from '../../../../scripts/Types/development.types'

export interface DevelopmentHarness {
    readonly dependencies: Partial<DevelopmentDependencies>
    readonly handlers: Map<ShutdownSignal, () => void>
    readonly removedSignals: ShutdownSignal[]
    readonly requests: SpawnRequest[]
}

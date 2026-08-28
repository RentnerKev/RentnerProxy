import type { FoundationHealth, ServiceHealth } from '../../../shared/Types/health.types'

export type FoundationService = keyof FoundationHealth

export interface FoundationHealthDependencies {
    readonly checkController: () => Promise<ServiceHealth>
    readonly checkDatabase: () => Promise<ServiceHealth>
    readonly checkRedis: () => Promise<ServiceHealth>
    readonly warn: (service: FoundationService) => void
}

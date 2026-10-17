import type { z } from 'zod'
import type {
    discoveryRegistrySchema,
    discoveryConnectSchema,
    discoveryActionSchema,
    discoveryInspectSchema,
} from '../management.ts'
import type { DockerDiscoverySnapshot } from './docker-discovery.types.ts'

export type DiscoveryRegistry = z.infer<typeof discoveryRegistrySchema>
export type DiscoveryOwner = DiscoveryRegistry['owners'][number]
export type DiscoveryConnect = z.infer<typeof discoveryConnectSchema>
export type DiscoveryAction = z.infer<typeof discoveryActionSchema>
export type DiscoveryInspect = z.infer<typeof discoveryInspectSchema>
export type DiscoveryCandidate = DockerDiscoverySnapshot['candidates'][number]
export type DiscoveryRowState =
    | 'create'
    | 'update'
    | 'current'
    | 'stopped'
    | 'orphaned'
    | 'conflicted'
    | 'unavailable'
    | 'detached'
export interface DiscoveryRow {
    readonly key: string
    readonly sourceId: string
    readonly containerId: string | null
    readonly hostId: string | null
    readonly domains: readonly string[]
    readonly target: DiscoveryCandidate['target']
    readonly state: DiscoveryRowState
    readonly issues: readonly string[]
}
export interface DiscoveryOverview {
    readonly snapshot: DockerDiscoverySnapshot | null
    readonly management: Omit<
        DiscoveryRegistry,
        'owners' | 'actorUserId' | 'endpointHash' | 'results'
    >
    readonly rows: readonly DiscoveryRow[]
    readonly previewToken: string
}

import type { z } from 'zod'
import type {
    dockerDiscoverySnapshotSchema,
    saveDockerDiscoverySchema,
    dockerDiscoveryErrors,
} from '../validation.ts'

export type DockerDiscoverySnapshot = z.infer<typeof dockerDiscoverySnapshotSchema>
export type SaveDockerDiscovery = z.infer<typeof saveDockerDiscoverySchema>
export type DockerDiscoveryErrorCode = (typeof dockerDiscoveryErrors)[number]

import type { ControllerRequestOptions } from './transport.types.ts'
import type { SaveDockerDiscovery } from '@/lib/DockerDiscovery/Types/docker-discovery.types.ts'

export type DockerDiscoveryRequest = (
    path: `/internal/v1/discovery/docker/${'status' | 'config'}`,
    options: ControllerRequestOptions,
) => Promise<unknown>
export type DockerDiscoverySaveRequest = SaveDockerDiscovery & { readonly actorUserId: string }

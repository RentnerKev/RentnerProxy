import type { DockerDiscoveryErrorCode } from '@/lib/DockerDiscovery/Types/docker-discovery.types.ts'

export class DockerDiscoveryError extends Error {
    constructor(readonly code: DockerDiscoveryErrorCode) {
        super(`admin.dockerDiscovery.errors.${code}`)
        this.name = 'DockerDiscoveryError'
    }
}

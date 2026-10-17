import '@tanstack/react-start/server-only'
import { z } from 'zod'
import {
    dockerDiscoverySnapshotSchema,
    dockerDiscoveryErrors,
} from '@/lib/DockerDiscovery/validation.ts'
import { DockerDiscoveryError } from '@/server/Admin/DockerDiscovery/docker-discovery.errors.ts'
import type {
    DockerDiscoveryRequest,
    DockerDiscoverySaveRequest,
} from './Types/docker-discovery.types.ts'
import { controllerRequest } from './transport.server.ts'

function decode(value: unknown) {
    const error = z.strictObject({ error: z.enum(dockerDiscoveryErrors) }).safeParse(value)
    if (error.success) throw new DockerDiscoveryError(error.data.error)
    const parsed = dockerDiscoverySnapshotSchema.safeParse(value)
    if (!parsed.success) throw new DockerDiscoveryError('controller_unavailable')
    return parsed.data
}
export function createDockerDiscoveryController(
    request: DockerDiscoveryRequest = controllerRequest,
) {
    const options = {
        privileged: true,
        confidential: true,
        timeoutMs: 10_000,
        responseLimit: 1_048_576,
        acceptNonOkJson: true,
    } as const
    return {
        async status() {
            return decode(await request('/internal/v1/discovery/docker/status', options))
        },
        async save(input: DockerDiscoverySaveRequest) {
            const value = decode(
                await request('/internal/v1/discovery/docker/config', {
                    ...options,
                    method: 'PUT',
                    body: JSON.stringify(input),
                }),
            )
            if (
                value.configuration.revision !== input.expectedRevision + 1 ||
                value.configuration.settings.enabled !== input.configuration.enabled ||
                value.configuration.settings.endpoint !== input.configuration.endpoint
            )
                throw new DockerDiscoveryError('controller_unavailable')
            return value
        },
    }
}
export const dockerDiscoveryController = createDockerDiscoveryController()

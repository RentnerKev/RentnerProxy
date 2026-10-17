import '@tanstack/react-start/server-only'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { DOCKER_DISCOVERY_MUTATION_RATE_LIMIT } from '@/config/docker-discovery.config.ts'
import { saveDockerDiscoverySchema } from '@/lib/DockerDiscovery/validation.ts'
import type { SaveDockerDiscovery } from '@/lib/DockerDiscovery/Types/docker-discovery.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { recordAuditEventBestEffortService } from '@/server/Audit/audit.service.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { dockerDiscoveryController } from '@/server/Controller/docker-discovery.server.ts'
import type { DockerDiscoveryDependencies } from './Types/docker-discovery.types.ts'
import { DockerDiscoveryError } from './docker-discovery.errors.ts'

export function createDockerDiscoveryService(deps: DockerDiscoveryDependencies) {
    async function audit(actorUserId: string, result: 'success' | 'failure') {
        try {
            await deps.audit({
                actorUserId,
                actorKind: 'user',
                action: 'update',
                resource: 'security-settings',
                targetId: null,
                result,
                metadata: { changedFields: ['dockerDiscovery'] },
            })
        } catch {
            console.error('[docker-discovery] Audit write unavailable')
        }
    }
    return {
        async getDockerDiscoveryService() {
            await deps.authorize(PERMISSIONS.DOCKER_DISCOVERY_VIEW)
            try {
                return await deps.controller.status()
            } catch (error) {
                throw error instanceof DockerDiscoveryError
                    ? error
                    : new DockerDiscoveryError('controller_unavailable')
            }
        },
        async saveDockerDiscoveryService(input: SaveDockerDiscovery) {
            const actor = await deps.authorize(PERMISSIONS.DOCKER_DISCOVERY_MANAGE)
            const parsed = saveDockerDiscoverySchema.safeParse(input)
            if (!parsed.success) throw new DockerDiscoveryError('invalid_input')
            await deps.limit(actor.id)
            let value
            try {
                value = await deps.controller.save({ ...parsed.data, actorUserId: actor.id })
            } catch (error) {
                await audit(actor.id, 'failure')
                throw error instanceof DockerDiscoveryError
                    ? error
                    : new DockerDiscoveryError('controller_unavailable')
            }
            await audit(actor.id, 'success')
            // Manage permission does not grant read access to source or candidate metadata.
            return { revision: value.configuration.revision }
        },
    }
}
export const { getDockerDiscoveryService, saveDockerDiscoveryService } =
    createDockerDiscoveryService({
        authorize: requirePermissionService,
        controller: dockerDiscoveryController,
        audit: recordAuditEventBestEffortService,
        limit: async (identifier) => {
            await consumeRateLimit({ ...DOCKER_DISCOVERY_MUTATION_RATE_LIMIT, identifier })
        },
    })

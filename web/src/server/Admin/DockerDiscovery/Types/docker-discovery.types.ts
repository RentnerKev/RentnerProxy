import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type { createDockerDiscoveryController } from '@/server/Controller/docker-discovery.server.ts'

export interface DockerDiscoveryDependencies {
    readonly authorize: (permission: PermissionKey) => Promise<{ readonly id: string }>
    readonly controller: Pick<ReturnType<typeof createDockerDiscoveryController>, 'status' | 'save'>
    readonly audit: (event: AuditEventInput) => Promise<void>
    readonly limit: (actorId: string) => Promise<void>
}

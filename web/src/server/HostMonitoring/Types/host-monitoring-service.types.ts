import type { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'

export interface HostMonitoringServiceDependencies {
    readonly database: typeof getAuthDatabase
    readonly requireActor: (permission: PermissionKey) => Promise<{ readonly id: string }>
    readonly rateLimit: (actorId: string) => Promise<void>
}

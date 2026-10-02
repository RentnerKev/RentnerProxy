import '@tanstack/react-start/server-only'

import { recordAuditEventBestEffortService } from '@/server/Audit/audit.service.ts'
import { exportPortableConfiguration } from './portable.ts'

export async function exportMigrationConfigurationService(actorUserId: string): Promise<string> {
    const body = await exportPortableConfiguration()
    await recordAuditEventBestEffortService({
        actorUserId,
        actorKind: 'user',
        action: 'save',
        resource: 'config-export',
        targetId: null,
        result: 'success',
    })
    return body
}

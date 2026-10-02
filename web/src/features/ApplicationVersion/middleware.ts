import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { APP_VERSION } from '@/lib/ApplicationVersion/version.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { getAvailableUpdateService } from '@/server/Updates/releases.service.ts'

export const getApplicationUpdateHandler = createServerFn({ method: 'GET' }).handler(async () => {
    await requirePermissionService(PERMISSIONS.APP_ACCESS)
    return { latestVersion: await getAvailableUpdateService(APP_VERSION) }
})

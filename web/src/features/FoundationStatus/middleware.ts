import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { checkFoundationHealthService } from '@/server/Foundation/health.service.ts'

export const getFoundationHealthHandler = createServerFn({ method: 'GET' }).handler(async () => {
    await requirePermissionService(PERMISSIONS.APP_ACCESS)
    return checkFoundationHealthService()
})

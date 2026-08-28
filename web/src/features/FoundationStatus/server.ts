import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '../../config/permissions.config'
import { requirePermissionService } from '../../server/Auth/Access/authorization.service'
import { checkFoundationHealth } from '../../server/Foundation/health.service'

export const getFoundationHealthHandler = createServerFn({ method: 'GET' }).handler(async () => {
    await requirePermissionService(PERMISSIONS.APP_ACCESS)
    return checkFoundationHealth()
})

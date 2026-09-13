import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '../../config/permissions.config'
import { APP_VERSION } from '../../config/version.config'
import { requirePermissionService } from '../../server/Auth/Access/authorization.service'
import { getAvailableUpdate } from '../../server/Updates/releases.service'

export const getApplicationUpdateHandler = createServerFn({ method: 'GET' }).handler(async () => {
    await requirePermissionService(PERMISSIONS.APP_ACCESS)
    return { latestVersion: await getAvailableUpdate(APP_VERSION) }
})

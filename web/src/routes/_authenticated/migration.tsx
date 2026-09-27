import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import MigrationPage from '../../features/Admin/Migration/MigrationPage'
import { requirePermissionRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_authenticated/migration')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.MIGRATION),
    component: MigrationPage,
})

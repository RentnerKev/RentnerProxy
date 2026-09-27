import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import NpmImportPage from '../../features/Admin/NpmImport/NpmImportPage'
import { requirePermissionRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_authenticated/npm-import')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.NPM_IMPORT),
    component: NpmImportPage,
})

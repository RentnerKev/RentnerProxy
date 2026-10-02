import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import NpmImportPage from '@/features/Admin/NpmImport/NpmImportPage.tsx'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_authenticated/npm-import')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.NPM_IMPORT),
    component: NpmImportPage,
})

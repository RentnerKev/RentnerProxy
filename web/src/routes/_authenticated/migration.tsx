import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import MigrationPage from '@/features/Admin/Migration/MigrationPage.tsx'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_authenticated/migration')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.MIGRATION),
    component: MigrationPage,
})

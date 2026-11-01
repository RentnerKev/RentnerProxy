import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import BackupsPage from '@/features/Admin/Backups/index.tsx'
import { backupSearchSchema } from '@/features/Admin/Backups/validation.ts'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_authenticated/backups')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.BACKUPS_VIEW),
    validateSearch: (search) => backupSearchSchema.parse(search),
    component: BackupsRoute,
})

function BackupsRoute() {
    const { user } = Route.useRouteContext()
    const { downloadError } = Route.useSearch()
    return (
        <BackupsPage
            key={user.id}
            userId={user.id}
            permissions={user.permissions}
            downloadError={downloadError}
        />
    )
}

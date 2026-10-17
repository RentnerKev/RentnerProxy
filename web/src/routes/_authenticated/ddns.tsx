import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import DdnsPage from '@/features/Admin/Ddns/index.tsx'
import { ddnsApi } from '@/features/Admin/Ddns/ddns-api.ts'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'
export const Route = createFileRoute('/_authenticated/ddns')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.DDNS_VIEW),
    component: DdnsRoute,
})
function DdnsRoute() {
    const { user } = Route.useRouteContext()
    return <DdnsPage permissions={user.permissions} api={ddnsApi} />
}

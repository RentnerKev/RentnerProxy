import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import DnsConnectionsPage from '@/features/Admin/DnsConnections/index.tsx'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_authenticated/dns-connections')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.DNS_CONNECTIONS_VIEW),
    component: DnsConnectionsRoute,
})

function DnsConnectionsRoute() {
    const { user } = Route.useRouteContext()
    return <DnsConnectionsPage permissions={user.permissions} />
}

import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import DdnsPage from '@/features/Admin/Ddns/index.tsx'
import { ddnsApi } from '@/features/Admin/Ddns/ddns-api.ts'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'
const DdnsDevelopment = import.meta.env.DEV
    ? lazy(() => import('@/features/Admin/Ddns/Development/index.tsx'))
    : null
export const Route = createFileRoute('/_authenticated/ddns')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.DDNS_VIEW),
    component: DdnsRoute,
})
function DdnsRoute() {
    const { user } = Route.useRouteContext()
    if (DdnsDevelopment)
        return (
            <Suspense>
                <DdnsDevelopment permissions={user.permissions} api={ddnsApi} />
            </Suspense>
        )
    return <DdnsPage permissions={user.permissions} api={ddnsApi} />
}

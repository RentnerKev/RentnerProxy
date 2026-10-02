import { createFileRoute } from '@tanstack/react-router'

import OperationsPage from '@/features/DefaultSite/index.tsx'
import { requireOperationsRoute } from '@/features/DefaultSite/route-guards.ts'

export const Route = createFileRoute('/_authenticated/operations')({
    beforeLoad: requireOperationsRoute,
    component: OperationsRoute,
})

function OperationsRoute() {
    const { user } = Route.useRouteContext()
    return <OperationsPage permissions={user.permissions} />
}

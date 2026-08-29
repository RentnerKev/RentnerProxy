import { createFileRoute } from '@tanstack/react-router'

import AuthenticatedRouteLayout from '../../features/Auth/Components/AuthenticatedRouteLayout'
import { requireAuthenticatedRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_authenticated')({
    beforeLoad: requireAuthenticatedRoute,
    component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
    const { user } = Route.useRouteContext()

    return <AuthenticatedRouteLayout key={user.id} user={user} />
}

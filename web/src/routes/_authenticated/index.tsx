import { createFileRoute } from '@tanstack/react-router'

import FoundationStatusPage from '../../features/FoundationStatus'

export const Route = createFileRoute('/_authenticated/')({
    component: FoundationStatusRoute,
})

function FoundationStatusRoute() {
    const { user } = Route.useRouteContext()
    return <FoundationStatusPage permissions={user.permissions} />
}

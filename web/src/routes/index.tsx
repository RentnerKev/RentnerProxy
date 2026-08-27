import { createFileRoute } from '@tanstack/react-router'

import FoundationStatus from '../features/FoundationStatus'
import { getFoundationHealth } from '../server/health.functions'

export const Route = createFileRoute('/')({
    loader: () => getFoundationHealth(),
    component: RouteComponent,
})

function RouteComponent() {
    const health = Route.useLoaderData()

    return <FoundationStatus health={health} />
}

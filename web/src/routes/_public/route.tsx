import { createFileRoute } from '@tanstack/react-router'

import PublicRouteLayout from '../../layout/Components/PublicRouteLayout'

export const Route = createFileRoute('/_public')({
    component: PublicRouteLayout,
})

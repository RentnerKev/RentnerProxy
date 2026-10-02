import { createFileRoute } from '@tanstack/react-router'

import PublicRouteLayout from '@/layouts/PublicLayout/index.tsx'

export const Route = createFileRoute('/_public')({
    component: PublicRouteLayout,
})

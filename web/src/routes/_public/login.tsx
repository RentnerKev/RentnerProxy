import { createFileRoute, Outlet } from '@tanstack/react-router'

import { requireAnonymousRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_public/login')({
    beforeLoad: requireAnonymousRoute,
    component: Outlet,
})

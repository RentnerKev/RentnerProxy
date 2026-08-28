import { createFileRoute } from '@tanstack/react-router'

import LoginPage from '../../features/Auth/Login'
import { requireAnonymousRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_public/login')({
    beforeLoad: requireAnonymousRoute,
    component: LoginPage,
})

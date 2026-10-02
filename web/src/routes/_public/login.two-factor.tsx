import { createFileRoute } from '@tanstack/react-router'

import TwoFactorLoginPage from '@/features/Auth/Login/Components/TwoFactorLoginPage.tsx'
import { requireAnonymousRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_public/login/two-factor')({
    beforeLoad: requireAnonymousRoute,
    component: TwoFactorLoginPage,
})

import { createFileRoute } from '@tanstack/react-router'

import ForgotPasswordPage from '@/features/Auth/ForgotPassword/index.tsx'
import { requireAnonymousRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_public/forgot-password')({
    beforeLoad: requireAnonymousRoute,
    component: ForgotPasswordPage,
})

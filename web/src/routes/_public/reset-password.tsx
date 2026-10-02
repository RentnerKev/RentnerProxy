import { createFileRoute } from '@tanstack/react-router'

import PasswordResetPage from '@/features/Auth/PasswordReset/index.tsx'
import { requireInitializedRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_public/reset-password')({
    beforeLoad: requireInitializedRoute,
    component: PasswordResetPage,
})

import { createFileRoute } from '@tanstack/react-router'

import SetupPage from '@/features/Auth/Setup/index.tsx'
import { requireSetupRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_public/setup')({
    beforeLoad: requireSetupRoute,
    component: SetupPage,
})

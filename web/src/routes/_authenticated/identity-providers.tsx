import { createFileRoute } from '@tanstack/react-router'
import OidcProvidersPage from '@/features/Admin/OidcProviders/index.tsx'
import { requireOwnerRoute } from '@/features/Auth/route-guards.ts'
export const Route = createFileRoute('/_authenticated/identity-providers')({
    beforeLoad: requireOwnerRoute,
    component: OidcProvidersPage,
})

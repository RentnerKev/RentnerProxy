import { createFileRoute } from '@tanstack/react-router'

import LoginPage from '@/features/Auth/Login/index.tsx'

export const Route = createFileRoute('/_public/login/')({
    validateSearch: (search: Record<string, unknown>): { oidcError?: 'failed' } =>
        search.oidcError === 'failed' ? { oidcError: 'failed' } : {},
    component: LoginPage,
})

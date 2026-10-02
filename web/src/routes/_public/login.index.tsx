import { createFileRoute } from '@tanstack/react-router'

import LoginPage from '@/features/Auth/Login/index.tsx'

export const Route = createFileRoute('/_public/login/')({
    component: LoginPage,
})

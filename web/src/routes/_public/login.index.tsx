import { createFileRoute } from '@tanstack/react-router'

import LoginPage from '../../features/Auth/Login'

export const Route = createFileRoute('/_public/login/')({
    component: LoginPage,
})

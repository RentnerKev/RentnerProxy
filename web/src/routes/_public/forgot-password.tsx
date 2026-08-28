import { createFileRoute } from '@tanstack/react-router'

import ForgotPasswordPage from '../../features/Auth/ForgotPassword'
import { requireAnonymousRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_public/forgot-password')({
    beforeLoad: requireAnonymousRoute,
    component: ForgotPasswordPage,
})

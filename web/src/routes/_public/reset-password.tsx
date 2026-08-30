import { createFileRoute } from '@tanstack/react-router'

import PasswordResetPage from '../../features/Auth/PasswordReset'
import { requireInitializedRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_public/reset-password')({
    beforeLoad: requireInitializedRoute,
    component: PasswordResetPage,
})

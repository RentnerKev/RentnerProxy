import { createFileRoute } from '@tanstack/react-router'

import TwoFactorLoginPage from '../../features/Auth/Login/Components/TwoFactorLoginPage'
import { requireAnonymousRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_public/login/two-factor')({
    beforeLoad: requireAnonymousRoute,
    component: TwoFactorLoginPage,
})

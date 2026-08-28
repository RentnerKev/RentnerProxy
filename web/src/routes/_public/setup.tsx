import { createFileRoute } from '@tanstack/react-router'

import SetupPage from '../../features/Auth/Setup'
import { requireSetupRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_public/setup')({
    beforeLoad: requireSetupRoute,
    component: SetupPage,
})

import { createFileRoute } from '@tanstack/react-router'

import AcceptInvitePage from '../../features/Auth/AcceptInvite'
import { requireAnonymousRoute } from '../../features/Auth/route-guards'

export const Route = createFileRoute('/_public/accept-invite')({
    beforeLoad: requireAnonymousRoute,
    component: AcceptInvitePage,
})

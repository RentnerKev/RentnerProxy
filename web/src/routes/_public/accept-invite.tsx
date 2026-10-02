import { createFileRoute } from '@tanstack/react-router'

import AcceptInvitePage from '@/features/Auth/AcceptInvite/index.tsx'
import { requireAnonymousRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_public/accept-invite')({
    beforeLoad: requireAnonymousRoute,
    component: AcceptInvitePage,
})

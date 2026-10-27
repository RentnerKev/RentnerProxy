import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'

export const Route = createFileRoute('/_authenticated/dns-connections')({
    beforeLoad: async (context) => {
        await requirePermissionRoute(PERMISSIONS.DNS_CONNECTIONS_VIEW)(context)
        throw redirect({ to: '/providers', replace: true })
    },
})

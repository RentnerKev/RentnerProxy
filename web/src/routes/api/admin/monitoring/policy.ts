import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { hostMonitoringHttpHandlers } from '@/server/HostMonitoring/host-monitoring-response.server.ts'

const handlePolicy = createServerOnlyFn(hostMonitoringHttpHandlers.policy)
export const Route = createFileRoute('/api/admin/monitoring/policy')({
    server: {
        handlers: {
            GET: ({ request }) => handlePolicy(request),
            POST: ({ request }) => handlePolicy(request),
        },
    },
})

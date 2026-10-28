import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { hostMonitoringHttpHandlers } from '@/server/HostMonitoring/host-monitoring-response.server.ts'

const handleHistory = createServerOnlyFn(hostMonitoringHttpHandlers.history)
export const Route = createFileRoute('/api/admin/monitoring/history')({
    server: { handlers: { GET: ({ request }) => handleHistory(request) } },
})

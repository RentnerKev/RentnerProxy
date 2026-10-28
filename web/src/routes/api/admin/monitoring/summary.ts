import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { hostMonitoringHttpHandlers } from '@/server/HostMonitoring/host-monitoring-response.server.ts'

const handleSummary = createServerOnlyFn(hostMonitoringHttpHandlers.summary)
export const Route = createFileRoute('/api/admin/monitoring/summary')({
    server: { handlers: { GET: ({ request }) => handleSummary(request) } },
})

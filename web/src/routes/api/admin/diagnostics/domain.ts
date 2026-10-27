import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { handleDomainDiagnosticsPost } from '@/server/RuntimeDiagnostics/domain-diagnostics-response.server.ts'

const diagnose = createServerOnlyFn(handleDomainDiagnosticsPost)
export const Route = createFileRoute('/api/admin/diagnostics/domain')({
    server: { handlers: { POST: ({ request }) => diagnose(request) } },
})

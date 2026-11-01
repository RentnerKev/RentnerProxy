import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { backupDownloadHttpHandler } from '@/server/Admin/Backups/backups-download-response.server.ts'

const handle = createServerOnlyFn(backupDownloadHttpHandler)
export const Route = createFileRoute('/api/admin/backups/$jobId/download')({
    server: { handlers: { GET: ({ request, params }) => handle(request, params.jobId) } },
})

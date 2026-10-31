import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { backupsHttpHandlers } from '@/server/Admin/Backups/backups-response.server.ts'

const handle = createServerOnlyFn(backupsHttpHandlers.status)
export const Route = createFileRoute('/api/admin/backups/status')({
    server: { handlers: { GET: ({ request }) => handle(request) } },
})

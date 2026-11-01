import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { backupsHttpHandlers } from '@/server/Admin/Backups/backups-response.server.ts'

const handle = createServerOnlyFn(backupsHttpHandlers.configureOffHost)
export const Route = createFileRoute('/api/admin/backups/off-host')({
    server: { handlers: { POST: ({ request }) => handle(request) } },
})

import { createFileRoute } from '@tanstack/react-router'

import { handleMigrationExport } from '../../../features/Admin/Migration/server'

export const Route = createFileRoute('/api/migration/export')({
    server: { handlers: { GET: () => handleMigrationExport() } },
})

import { createFileRoute } from '@tanstack/react-router'

import { handleMigrationExportHandler } from '@/features/Admin/Migration/middleware.ts'

export const Route = createFileRoute('/api/migration/export')({
    server: { handlers: { GET: () => handleMigrationExportHandler() } },
})

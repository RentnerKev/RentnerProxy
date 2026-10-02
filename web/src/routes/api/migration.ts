import { createFileRoute } from '@tanstack/react-router'

import {
    handleMigrationGetHandler,
    handleMigrationPostHandler,
} from '@/features/Admin/Migration/middleware.ts'

export const Route = createFileRoute('/api/migration')({
    server: {
        handlers: {
            GET: () => handleMigrationGetHandler(),
            POST: ({ request }) => handleMigrationPostHandler(request),
        },
    },
})

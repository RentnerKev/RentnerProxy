import { createFileRoute } from '@tanstack/react-router'

import { handleMigrationGet, handleMigrationPost } from '../../features/Admin/Migration/server'

export const Route = createFileRoute('/api/migration')({
    server: {
        handlers: {
            GET: () => handleMigrationGet(),
            POST: ({ request }) => handleMigrationPost(request),
        },
    },
})

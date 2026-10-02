import { createFileRoute } from '@tanstack/react-router'

import {
    handleNpmImportGetHandler,
    handleNpmImportPostHandler,
} from '@/features/Admin/NpmImport/middleware.ts'

export const Route = createFileRoute('/api/npm-import')({
    server: {
        handlers: {
            POST: ({ request }) => handleNpmImportPostHandler(request),
            GET: () => handleNpmImportGetHandler(),
        },
    },
})

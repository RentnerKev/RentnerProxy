import { createFileRoute } from '@tanstack/react-router'

import { handleNpmImportGet, handleNpmImportPost } from '../../features/Admin/NpmImport/server'

export const Route = createFileRoute('/api/npm-import')({
    server: {
        handlers: {
            POST: ({ request }) => handleNpmImportPost(request),
            GET: () => handleNpmImportGet(),
        },
    },
})

import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { handleOidcConnectionsRequest } from '@/server/Auth/Oidc/oidc-connections-response.server.ts'

const handle = createServerOnlyFn(handleOidcConnectionsRequest)
export const Route = createFileRoute('/api/auth/oidc/connections')({
    server: {
        handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
    },
})

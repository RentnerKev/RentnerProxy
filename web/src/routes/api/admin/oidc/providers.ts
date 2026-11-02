import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { handleOidcProviderRequest } from '@/server/Auth/Oidc/oidc-provider-response.server.ts'

const handle = createServerOnlyFn(handleOidcProviderRequest)
export const Route = createFileRoute('/api/admin/oidc/providers')({
    server: {
        handlers: {
            GET: ({ request }) => handle(request),
            POST: ({ request }) => handle(request),
            PUT: ({ request }) => handle(request),
            PATCH: ({ request }) => handle(request),
            DELETE: ({ request }) => handle(request),
            OPTIONS: ({ request }) => handle(request),
            HEAD: ({ request }) => handle(request),
        },
    },
})

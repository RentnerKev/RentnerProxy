import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { oidcHttpHandlers } from '@/server/Auth/Oidc/oidc-response.server.ts'

const callback = createServerOnlyFn(oidcHttpHandlers.callback)
export const Route = createFileRoute('/api/auth/oidc/callback')({
    server: { handlers: { GET: ({ request }) => callback(request) } },
})

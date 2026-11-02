import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { oidcHttpHandlers } from '@/server/Auth/Oidc/oidc-response.server.ts'

const start = createServerOnlyFn(oidcHttpHandlers.start)
export const Route = createFileRoute('/api/auth/oidc/start')({
    server: { handlers: { POST: ({ request }) => start(request) } },
})

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/health/live')({
    server: {
        handlers: {
            GET: () =>
                Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } }),
        },
    },
})

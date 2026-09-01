import { createFileRoute } from '@tanstack/react-router'

import { getFoundationReadiness } from '../../features/Health/server'

export const Route = createFileRoute('/health/ready')({
    server: {
        handlers: {
            GET: async () => {
                const ready = await getFoundationReadiness()
                return Response.json(
                    { status: ready ? 'ready' : 'not_ready' },
                    {
                        status: ready ? 200 : 503,
                        headers: { 'cache-control': 'no-store' },
                    },
                )
            },
        },
    },
})

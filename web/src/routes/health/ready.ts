import { createFileRoute } from '@tanstack/react-router'

import { getFoundationReadinessHandler } from '@/features/Health/middleware.ts'

export const Route = createFileRoute('/health/ready')({
    server: {
        handlers: {
            GET: async () => {
                const ready = await getFoundationReadinessHandler()
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

import { createFileRoute } from '@tanstack/react-router'

import { getProfileImageResponseHandler } from '@/features/UserSettings/middleware.ts'

export const Route = createFileRoute('/media/avatars/$userId')({
    server: {
        handlers: {
            GET: ({ params, request }) =>
                getProfileImageResponseHandler({ request, userId: params.userId }),
        },
    },
})

import { createFileRoute } from '@tanstack/react-router'

import { getProfileImageResponse } from '../../../features/UserSettings/server'

export const Route = createFileRoute('/media/avatars/$userId')({
    server: {
        handlers: {
            GET: ({ params, request }) =>
                getProfileImageResponse({ request, userId: params.userId }),
        },
    },
})

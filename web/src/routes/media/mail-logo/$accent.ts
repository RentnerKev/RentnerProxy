import { createFileRoute } from '@tanstack/react-router'
import { getMailLogoResponseHandler } from '@/features/Branding/middleware.ts'

export const Route = createFileRoute('/media/mail-logo/$accent')({
    server: {
        handlers: {
            GET: ({ params, request }) => getMailLogoResponseHandler(request, params.accent),
        },
    },
})

import type { Register } from '@tanstack/react-router'
import type { RequestHandler } from '@tanstack/react-start/server'

export function withRequestAbortHandling(
    handler: RequestHandler<Register>,
): RequestHandler<Register> {
    return (request, options) => {
        const controller = new AbortController()
        // TanStack passes rejected abort reasons to H3. H3 understands a Response, whereas
        // an ordinary AbortError becomes a logged 500. Keep unrelated failures untouched.
        const abort = () => controller.abort(new Response(null, { status: 499 }))
        if (request.signal.aborted) abort()
        else request.signal.addEventListener('abort', abort, { once: true })

        const forwardedRequest = new Request(request, { signal: controller.signal })
        // Preserve the connection address installed by docker/web/request-context.ts.
        // It is server-owned metadata, never a forwarded HTTP header.
        const peerAddress = Object.getOwnPropertyDescriptor(request, 'ip')
        if (peerAddress) Object.defineProperty(forwardedRequest, 'ip', peerAddress)

        // Retain cancellation after headers are returned, while the response is streaming.
        return handler(forwardedRequest, options)
    }
}

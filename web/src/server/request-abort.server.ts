import type { Register } from '@tanstack/react-router'
import type { RequestHandler } from '@tanstack/react-start/server'

export function withRequestAbortHandling(
    handler: RequestHandler<Register>,
): RequestHandler<Register> {
    return (request, options) => {
        const controller = new AbortController()

        const abort = () => controller.abort(new Response(null, { status: 499 }))
        if (request.signal.aborted) abort()
        else request.signal.addEventListener('abort', abort, { once: true })

        const forwardedRequest = new Request(request, { signal: controller.signal })

        const peerAddress = Object.getOwnPropertyDescriptor(request, 'ip')
        if (peerAddress) Object.defineProperty(forwardedRequest, 'ip', peerAddress)

        return handler(forwardedRequest, options)
    }
}

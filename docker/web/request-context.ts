import { isIP } from 'node:net'

interface RuntimeApplication {
    fetch(request: Request): Response | Promise<Response>
}

interface PeerAddressProvider {
    requestIP(request: Request): { readonly address: string } | null
}

export function createRuntimeFetch(application: RuntimeApplication) {
    return (request: Request, server: PeerAddressProvider): Response | Promise<Response> => {
        const address = server.requestIP(request)?.address

        // TanStack's request context reads this server-owned property. HTTP headers must never
        // supply it: the peer address belongs to this connection, including behind a proxy.
        Object.defineProperty(request, 'ip', {
            configurable: false,
            enumerable: false,
            value: address && isIP(address) ? address : undefined,
            writable: false,
        })

        return application.fetch(request)
    }
}

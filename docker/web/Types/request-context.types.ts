export interface RuntimeApplication {
    fetch(request: Request): Response | Promise<Response>
}

export interface PeerAddressProvider {
    requestIP(request: Request): { readonly address: string } | null
}

type RuntimeServer = Readonly<{
    requestIP(request: Request): { readonly address: string } | null
}>

export type RuntimeFetch = (request: Request, server: RuntimeServer) => Response | Promise<Response>

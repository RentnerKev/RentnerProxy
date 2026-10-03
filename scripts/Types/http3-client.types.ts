export type Http3Command = (
    args: string[],
    options?: { readonly timeoutMs?: number },
) => Promise<string>

export interface Http3Request {
    readonly image: string
    readonly caFile: string
    readonly hostname: string
    readonly port: number
    readonly path?: string
    readonly protocol?: '--http3-only' | '--http3' | '--http2' | '--http1.1'
    readonly network?: string
    readonly address?: string
    readonly headers?: readonly string[]
    readonly credentials?: string
}

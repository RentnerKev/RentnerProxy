export type UpstreamTlsSettings = {
    readonly verifyUpstreamTls: boolean
    readonly upstreamTlsServerName: string | null
    readonly trustedCaId: string | null
}

export type ExistingProxyHost = UpstreamTlsSettings & {
    readonly forwardScheme: 'http' | 'https'
}

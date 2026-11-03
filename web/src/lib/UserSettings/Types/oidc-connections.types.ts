export interface OidcConnections {
    readonly revision: number
    readonly externallyManaged: boolean
    readonly providers: ReadonlyArray<{
        readonly id: string
        readonly name: string
        readonly enabled: boolean
        readonly linked: boolean
    }>
}

export interface OidcConnectionAction {
    readonly providerId: string
    readonly kind: 'link' | 'unlink'
    readonly expectedRevision: number
}

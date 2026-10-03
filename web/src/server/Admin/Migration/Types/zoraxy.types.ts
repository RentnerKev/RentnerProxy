export type SourceEntry = { readonly name: string; readonly value: unknown }

export interface ZoraxySource {
    readonly proxies: readonly SourceEntry[]
    readonly redirects: readonly SourceEntry[]
    readonly omitted: {
        readonly streams: number
        readonly accessRules: number
        readonly certificates: number
        readonly pathRules: number
    }
}

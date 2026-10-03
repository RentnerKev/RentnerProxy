export type DefaultSiteSettings =
    | { readonly mode: 'not-found' }
    | { readonly mode: 'welcome' }
    | { readonly mode: 'close' }
    | { readonly mode: 'redirect'; readonly url: string }
    | { readonly mode: 'custom-html'; readonly html: string }

export interface DefaultSiteEditorData {
    readonly baseRevision: string
    readonly settings: DefaultSiteSettings
}

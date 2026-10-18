export interface HostDomainListOptions {
    readonly initialDomains: readonly string[]
    readonly maxDomains: number
    readonly isPending: boolean
    readonly form: {
        readonly state: { readonly values: { readonly domains: string[] } }
        readonly pushFieldValue: (name: 'domains', value: string) => unknown
        readonly removeFieldValue: (name: 'domains', index: number) => unknown
    }
}

export interface HostDomainListResult {
    readonly state: { readonly domainKeys: string[] }
    readonly handler: {
        readonly addDomain: () => void
        readonly removeDomain: (index: number) => void
    }
}

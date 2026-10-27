export interface TxtRecord {
    readonly id: string
    readonly type: 'TXT'
    readonly name: string
    readonly content: string
    readonly comment?: string
}

export interface DnsFixtureDelegation {
    readonly cnames: ReadonlyMap<string, string>
    readonly nameservers: ReadonlyMap<string, readonly string[]>
    readonly zones: ReadonlyMap<string, string>
}

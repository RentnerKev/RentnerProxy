export interface PolicyFixture {
    readonly basicPolicyId: string
    readonly ipPolicyId: string
    readonly basicHostId: string
    readonly ipHostId: string
    readonly basicDomain: string
    readonly ipDomain: string
    readonly username: string
    readonly password: string
    readonly passwordHash: string
    readonly ipRules: {
        readonly defaultAction: 'deny'
        readonly allow: readonly string[]
        readonly deny: readonly string[]
    }
}

export interface UpgradeFixture {
    readonly runId: string
    readonly ownerUserId: string
    readonly adminUserId: string
    readonly customUserId: string
    readonly customRoleId: string
    readonly customRoleKey: string
    readonly customPermissionKeys: readonly string[]
    readonly liveProxyHostId: string
    readonly disabledTlsProxyHostId: string
    readonly redirectHostId: string
    readonly certificateId: string
    readonly trustedCaId: string
    readonly trustedCaFingerprint: string
    readonly trustedCaNotBefore: string
    readonly trustedCaNotAfter: string
    readonly passwordHash: string
    readonly certificateIssuedAt: string
    readonly certificateExpiresAt: string
    readonly certificateIssuer: string
    readonly certificateFingerprint: string
    readonly hostDomain: string
    readonly aliasDomain: string
    readonly disabledTlsDomain: string
    readonly redirectDomain: string
    readonly caPem: string
    readonly redirectDestination: string
    readonly redirectStatus: number
    readonly upstreamPort: number
    readonly globalHttpSettings: Readonly<Record<string, number>>
    readonly hostHttpSettings: Readonly<Record<string, number>>
    readonly unsupportedHostSettings: Readonly<Record<string, number>>
    readonly advancedConfig: string
    readonly managementOrigin?: string
}

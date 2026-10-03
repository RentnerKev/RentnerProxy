import type { ProxyHostForwardScheme } from '@/config/Types/proxy-hosts-config.types.ts'
import type { RedirectHostStatusCode } from '@/config/Types/redirect-hosts-config.types.ts'
import type { ProxyHttpSettings } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import type { ProxyHostAccessPolicy } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { DefaultSiteSettings } from '@/lib/DefaultSite/Types/default-site.types.ts'

export type ProxyHostHttpSettings = Pick<
    ProxyHttpSettings,
    | 'clientMaxBodySizeBytes'
    | 'proxyConnectTimeoutSeconds'
    | 'proxyReadTimeoutSeconds'
    | 'proxySendTimeoutSeconds'
>

export interface ProxyRuntimeHost {
    readonly id: string
    readonly domains: ReadonlyArray<string>
    readonly forwardScheme: ProxyHostForwardScheme
    readonly forwardHost: string
    readonly forwardPort: number
    readonly httpSettings?: ProxyHostHttpSettings
    readonly certificateId?: string | null
    readonly forceHttps?: boolean
    readonly upstreamTls?: ProxyRuntimeUpstreamTls
    readonly accessPolicy?: ProxyHostAccessPolicy | undefined
}

export interface ProxyRuntimeUpstreamTls {
    readonly verify: boolean
    readonly serverName: string | null
    readonly trustedCaId: string | null
}

export interface ProxyRuntimeTrustedCa {
    readonly id: string
    readonly pem: string
    readonly fingerprintSha256: string
}

export interface RedirectRuntimeHost {
    readonly id: string
    readonly domains: ReadonlyArray<string>
    readonly destination: string
    readonly statusCode: RedirectHostStatusCode
    readonly preserveRequestUri: boolean
    readonly certificateId?: string | null
}

export interface ProxyRuntimeSnapshot {
    readonly version: 7
    readonly revision: string
    readonly proxyHosts: ReadonlyArray<ProxyRuntimeHost>
    readonly redirectHosts: ReadonlyArray<RedirectRuntimeHost>
    readonly httpSettings: ProxyHttpSettings
    readonly trustedCas: ReadonlyArray<ProxyRuntimeTrustedCa>
    readonly defaultSite?: DefaultSiteSettings
}

export interface ProxyRuntimeApplyResponse {
    readonly status: 'applied' | 'unchanged'
    readonly activeRevision: string
    readonly lastApplyAt: string | null
}

import type { PERMISSIONS } from '@/config/permissions.config.ts'

export type RuntimeViewPermission =
    | typeof PERMISSIONS.PROXY_HOSTS_VIEW
    | typeof PERMISSIONS.REDIRECT_HOSTS_VIEW
    | typeof PERMISSIONS.ACCESS_POLICIES_VIEW

export type RuntimeApplyPermission =
    | typeof PERMISSIONS.PROXY_HOSTS_APPLY
    | typeof PERMISSIONS.REDIRECT_HOSTS_APPLY
    | typeof PERMISSIONS.ACCESS_POLICIES_APPLY

import type { accessPolicies, proxyHosts, redirectHosts, hostDomains } from '@/db/schema.ts'

export type PolicyExportRow = Pick<
    typeof accessPolicies.$inferSelect,
    'id' | 'name' | 'description' | 'mode' | 'ipRules'
>

export type ProxyExportRow = Pick<
    typeof proxyHosts.$inferSelect,
    | 'id'
    | 'forwardScheme'
    | 'forwardHost'
    | 'forwardPort'
    | 'enabled'
    | 'forceHttps'
    | 'verifyUpstreamTls'
    | 'upstreamTlsServerName'
    | 'accessPolicyId'
    | 'certificateId'
    | 'trustedCaId'
>

export type RedirectExportRow = Pick<
    typeof redirectHosts.$inferSelect,
    'id' | 'destination' | 'statusCode' | 'preserveRequestUri' | 'enabled' | 'certificateId'
>

export type DomainExportRow = Pick<
    typeof hostDomains.$inferSelect,
    'domain' | 'proxyHostId' | 'redirectHostId'
>

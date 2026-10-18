import '@tanstack/react-start/server-only'

import { proxyHosts } from '@/db/schema.ts'

export const proxyHostRoutingColumns = {
    id: proxyHosts.id,
    forwardScheme: proxyHosts.forwardScheme,
    forwardHost: proxyHosts.forwardHost,
    forwardPort: proxyHosts.forwardPort,
    certificateId: proxyHosts.certificateId,
    forceHttps: proxyHosts.forceHttps,
    verifyUpstreamTls: proxyHosts.verifyUpstreamTls,
    upstreamTlsServerName: proxyHosts.upstreamTlsServerName,
    trustedCaId: proxyHosts.trustedCaId,
    accessPolicyId: proxyHosts.accessPolicyId,
}

export const proxyHostSummaryColumns = {
    ...proxyHostRoutingColumns,
    createdAt: proxyHosts.createdAt,
    enabled: proxyHosts.enabled,
    updatedAt: proxyHosts.updatedAt,
}

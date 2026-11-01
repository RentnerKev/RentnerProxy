import type {
    ProxyHostEditorFormValues,
    ProxyHostFormModalProps,
} from '@/features/Admin/ProxyHostManagement/Components/ProxyHostFormModal/Types/proxy-host-form.types.ts'
import type { ProxyHostSummary } from './Types/proxy-hosts.types.ts'

export function getProxyHostFormValues(
    mode: ProxyHostFormModalProps['mode'],
    proxyHost?: ProxyHostSummary,
): ProxyHostEditorFormValues {
    const source = mode === 'create' ? undefined : proxyHost
    return {
        browserCache: source?.browserCache,
        responseCache: source?.responseCache ? structuredClone(source.responseCache) : null,
        ...(source?.tags ? { tagIds: source.tags.map((tag) => tag.id) } : {}),
        responseCompression: source?.responseCompression ?? null,
        domains: mode === 'edit' && source ? [...source.domains] : [''],
        forwardScheme: source?.forwardScheme ?? 'http',
        forwardHost: source?.upstreamPool?.members[0]?.host ?? source?.forwardHost ?? '',
        forwardPort: String(source?.upstreamPool?.members[0]?.port ?? source?.forwardPort ?? 80),
        upstreamPool: source?.upstreamPool
            ? {
                  policy: source.upstreamPool.policy,
                  members: source.upstreamPool.members.map((member) => ({
                      host: member.host,
                      port: String(member.port),
                  })),
              }
            : null,
        enabled: source?.enabled ?? true,
        certificateId: source?.certificateId ?? null,
        forceHttps: source?.forceHttps ?? false,
        verifyUpstreamTls:
            source?.forwardScheme === 'https' ? (source.verifyUpstreamTls ?? true) : true,
        upstreamTlsServerName: source?.upstreamTlsServerName ?? null,
        trustedCaId: source?.trustedCaId ?? null,
        accessPolicyId: source?.accessPolicyId ?? null,
    }
}

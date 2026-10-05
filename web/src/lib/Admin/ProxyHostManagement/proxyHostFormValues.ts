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
        domains: mode === 'edit' && source ? [...source.domains] : [''],
        forwardScheme: source?.forwardScheme ?? 'http',
        forwardHost: source?.forwardHost ?? '',
        forwardPort: String(source?.forwardPort ?? 80),
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

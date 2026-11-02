import type {
    ProxyHostEditorFormValues,
    ProxyHostFormModalProps,
} from '@/features/Admin/ProxyHostManagement/Components/ProxyHostFormModal/Types/proxy-host-form.types.ts'
import type { ProxyHostSummary } from './Types/proxy-hosts.types.ts'
import type { ProxyUpstreamFailover } from '@/lib/ProxyRuntime/Types/upstream-pool.types.ts'

/** Copies enabled failover sections into independent string-valued editor drafts, preserving absent features. */
export function getUpstreamFailoverFormValues(
    failover: ProxyUpstreamFailover,
): NonNullable<NonNullable<ProxyHostEditorFormValues['upstreamPool']>['failover']> {
    return {
        ...(failover.active
            ? {
                  active: {
                      path: failover.active.path,
                      intervalSeconds: String(failover.active.intervalSeconds),
                      timeoutSeconds: String(failover.active.timeoutSeconds),
                      fails: String(failover.active.fails),
                      passes: String(failover.active.passes),
                      expectedStatus: String(failover.active.expectedStatus),
                  },
              }
            : {}),
        ...(failover.passive
            ? {
                  passive: {
                      failDurationSeconds: String(failover.passive.failDurationSeconds),
                      maxFails: String(failover.passive.maxFails),
                  },
              }
            : {}),
        ...(failover.retries
            ? {
                  retries: {
                      maxRetries: String(failover.retries.maxRetries),
                      tryDurationSeconds: String(failover.retries.tryDurationSeconds),
                      tryIntervalMilliseconds: String(failover.retries.tryIntervalMilliseconds),
                  },
              }
            : {}),
    }
}

/**
 * Creates an independent editor draft, using the first pool member as the scalar target.
 * Edit retains copied domains; duplicate clears domains while copying ordered targets and settings.
 * Create ignores any source, and single-target drafts use null so existing pools can be removed explicitly.
 */
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
                  ...(source.upstreamPool.failover
                      ? { failover: getUpstreamFailoverFormValues(source.upstreamPool.failover) }
                      : {}),
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

// oxlint-disable-next-line import/no-unassigned-import -- Keeps private configuration snapshots behind the server boundary.
import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { DomainDiagnosticsInput } from '@/lib/RuntimeDiagnostics/Types/domain-diagnostics.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { readProxyHostSummariesInTransaction } from '@/server/Admin/ProxyHostManagement/proxy-hosts.service.ts'
import { readRedirectHostSummariesInTransaction } from '@/server/Admin/RedirectHostManagement/redirect-hosts.service.ts'
import { readProxyRuntimeSnapshot } from '@/server/ProxyRuntime/proxy-runtime-data.ts'
import type { HostMonitoringProbeContext } from '@/server/HostMonitoring/Types/host-monitoring-probe.types.ts'
import type { DomainDiagnosticsContext } from './Types/domain-diagnostics.types.ts'
import { DomainDiagnosticsError } from './domain-diagnostics.errors.ts'

function contextHash(value: unknown): string {
    return 'sha256:' + new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex')
}

async function readDomainDiagnosticsStateInTransaction(
    transaction: AuthTransaction,
    input: DomainDiagnosticsInput,
) {
    const rows =
        input.hostType === 'proxy'
            ? await readProxyHostSummariesInTransaction(transaction, [input.hostId])
            : await readRedirectHostSummariesInTransaction(transaction, [input.hostId])
    const host = rows.find((row) => row.id === input.hostId)
    if (!host || !host.domains.includes(input.domain))
        throw new DomainDiagnosticsError('invalid_input')
    const snapshot = await readProxyRuntimeSnapshot(transaction)
    const context: DomainDiagnosticsContext = {
        enabled: host.enabled,
        proof: contextHash(host),
        revision: snapshot.revision,
    }
    return { host, snapshot, context }
}

// Interactive safety fences retain the full private host proof and global revision.
export async function readDomainDiagnosticsContextInTransaction(
    transaction: AuthTransaction,
    input: DomainDiagnosticsInput,
): Promise<DomainDiagnosticsContext> {
    return (await readDomainDiagnosticsStateInTransaction(transaction, input)).context
}

export async function readHostMonitoringContextInTransaction(
    transaction: AuthTransaction,
    input: DomainDiagnosticsInput,
): Promise<HostMonitoringProbeContext> {
    if (input.hostType !== 'proxy') throw new DomainDiagnosticsError('invalid_input')
    const { host, snapshot, context } = await readDomainDiagnosticsStateInTransaction(
        transaction,
        input,
    )
    if (!('forwardHost' in host)) throw new DomainDiagnosticsError('invalid_input')
    // Only inputs observed by the upstream check define continuity across checks.
    // Inbound certificates, discovery/jobs, access policy and other hosts remain
    // within-probe fences, but cannot reset a host's availability history.
    const upstreamTls =
        host.forwardScheme === 'https'
            ? {
                  verify: host.verifyUpstreamTls,
                  serverName: host.upstreamTlsServerName,
                  trustedCaId: host.trustedCaId,
              }
            : null
    const projection = {
        domains: host.domains.toSorted(),
        enabled: host.enabled,
        forwardScheme: host.forwardScheme,
        forwardHost: host.forwardHost,
        forwardPort: host.forwardPort,
        upstreamTls,
    }
    const ca =
        upstreamTls?.verify && upstreamTls.trustedCaId
            ? snapshot.trustedCas.find((candidate) => candidate.id === upstreamTls.trustedCaId)
            : undefined
    return {
        ...context,
        availability: {
            proof: contextHash(projection),
            revision: contextHash({
                host: projection,
                trustedCa: ca
                    ? {
                          fingerprintSha256: ca.fingerprintSha256,
                          pemHash: contextHash(ca.pem),
                      }
                    : null,
            }),
        },
    }
}

export function readDomainDiagnosticsContext(
    actorId: string,
    input: DomainDiagnosticsInput,
): Promise<DomainDiagnosticsContext> {
    return getAuthDatabase().transaction(
        async (transaction) => {
            await transaction.execute(sql`set local statement_timeout = '2000ms'`)
            await requirePermissionInTransaction(
                transaction,
                actorId,
                input.hostType === 'proxy'
                    ? PERMISSIONS.PROXY_HOSTS_VIEW
                    : PERMISSIONS.REDIRECT_HOSTS_VIEW,
            )
            return readDomainDiagnosticsContextInTransaction(transaction, input)
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
}

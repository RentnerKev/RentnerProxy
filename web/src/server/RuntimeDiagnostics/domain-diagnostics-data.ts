// oxlint-disable-next-line import/no-unassigned-import -- Keeps private configuration snapshots behind the server boundary.
import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { DomainDiagnosticsInput } from '@/lib/RuntimeDiagnostics/Types/domain-diagnostics.types.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { readProxyHostSummariesInTransaction } from '@/server/Admin/ProxyHostManagement/proxy-hosts.service.ts'
import { readRedirectHostSummariesInTransaction } from '@/server/Admin/RedirectHostManagement/redirect-hosts.service.ts'
import { readProxyRuntimeSnapshot } from '@/server/ProxyRuntime/proxy-runtime-data.ts'
import type { DomainDiagnosticsContext } from './Types/domain-diagnostics.types.ts'
import { DomainDiagnosticsError } from './domain-diagnostics.errors.ts'

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
            const rows =
                input.hostType === 'proxy'
                    ? await readProxyHostSummariesInTransaction(transaction, [input.hostId])
                    : await readRedirectHostSummariesInTransaction(transaction, [input.hostId])
            const host = rows.find((row) => row.id === input.hostId)
            if (!host || !host.domains.includes(input.domain))
                throw new DomainDiagnosticsError('invalid_input')
            const snapshot = await readProxyRuntimeSnapshot(transaction)
            return {
                enabled: host.enabled,
                proof:
                    'sha256:' +
                    new Bun.CryptoHasher('sha256').update(JSON.stringify(host)).digest('hex'),
                revision: snapshot.revision,
            }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
}

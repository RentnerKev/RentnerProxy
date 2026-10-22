import '@tanstack/react-start/server-only'
import { eq } from 'drizzle-orm'
import { accessPolicies, proxyHosts, redirectHosts } from '@/db/schema.ts'
import { readProxyHostSummariesInTransaction } from '@/server/Admin/ProxyHostManagement/proxy-hosts.service.ts'
import { readRedirectHostSummariesInTransaction } from '@/server/Admin/RedirectHostManagement/redirect-hosts.service.ts'
import { readHostTags, writeHostTags } from '@/server/Admin/HostTags/host-tags.storage.server.ts'
import { assertDiscoveryHostEditable } from '@/server/Admin/DockerDiscovery/discovery-storage.server.ts'
import { validateCertificateAssignmentInTransaction } from '@/server/Admin/CertificateManagement/certificates.service.ts'
import { validateTrustedCaAssignmentInTransaction } from '@/server/Admin/TrustedCaManagement/trusted-cas.service.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { lockProxyRuntimeSettings } from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import { reconcileProxyConfigurationWithAudit } from '@/server/ProxyRuntime/proxy-runtime.service.ts'
import { assignHostTags } from '@/lib/HostTags/hostTags.ts'
import { bulkHostTagIds } from '@/lib/HostBulkActions/bulkHostActions.ts'
import { ProxyHostDomainError } from '@/server/Admin/ProxyHostManagement/proxy-hosts.errors.ts'
import { createBulkHostServices } from './bulk-hosts.service.ts'

export const bulkHostServices = createBulkHostServices({
    authorize: requirePermissionService,
    reauthorize: requirePermissionInTransaction,
    transaction: (run, readOnly) =>
        getAuthDatabase().transaction(
            run,
            readOnly ? { isolationLevel: 'repeatable read', accessMode: 'read only' } : undefined,
        ),
    savepoint: (transaction, run) => transaction.transaction(run),
    lock: lockProxyRuntimeSettings,
    read: (transaction, kind, ids) =>
        kind === 'proxy'
            ? readProxyHostSummariesInTransaction(transaction, ids)
            : readRedirectHostSummariesInTransaction(transaction, ids),
    readTags: readHostTags,
    validate: async (transaction, host, action, preview) => {
        if ('forwardHost' in host && action.type !== 'addTags' && action.type !== 'removeTags')
            await assertDiscoveryHostEditable(transaction, host.id)
        if (action.type === 'accessPolicy' && action.accessPolicyId) {
            const [policy] = await transaction
                .select({ id: accessPolicies.id })
                .from(accessPolicies)
                .where(eq(accessPolicies.id, action.accessPolicyId))
                .limit(1)
            if (!policy)
                throw new ProxyHostDomainError('invalid_input', 'Access policy was not found.')
        }
        if (action.type === 'certificate' || action.type === 'enable') {
            if (action.type === 'enable' && 'trustedCaId' in host)
                await validateTrustedCaAssignmentInTransaction(transaction, host.trustedCaId)
            await validateCertificateAssignmentInTransaction(
                transaction,
                action.type === 'certificate' ? action.certificateId : host.certificateId,
                'forceHttps' in host && host.forceHttps,
                host.domains,
                !preview,
            )
        }
    },
    write: async (transaction, kind, host, action, tags) => {
        if (action.type === 'addTags' || action.type === 'removeTags') {
            const next = assignHostTags(tags, host.id, bulkHostTagIds(tags, host.id, action))
            if (next !== tags) await writeHostTags(transaction, kind, next)
            return
        }
        const table = kind === 'proxy' ? proxyHosts : redirectHosts
        const change =
            action.type === 'enable' || action.type === 'disable'
                ? { enabled: action.type === 'enable' }
                : action.type === 'certificate'
                  ? { certificateId: action.certificateId }
                  : { accessPolicyId: action.accessPolicyId }
        await transaction
            .update(table)
            .set({ ...change, updatedAt: new Date() })
            .where(eq(table.id, host.id))
    },
    audit: appendAuditEventInTransactionService,
    reconcile: reconcileProxyConfigurationWithAudit,
    now: Date.now,
})

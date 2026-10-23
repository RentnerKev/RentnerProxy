import {
    readResponseCacheSettingsMap,
    writeResponseCacheSettings,
} from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import type { ProxyHostMutationSummary } from './Types/proxy-hosts.types.ts'
import { proxyHostSummaryColumns } from './proxy-hosts.storage.server.ts'
import '@tanstack/react-start/server-only'
import { tagsForHost } from '@/lib/HostTags/hostTags.ts'
import { readHostTags } from '@/server/Admin/HostTags/host-tags.storage.server.ts'
import { assignHostTagsInTransaction } from '@/server/Admin/HostTags/host-tags.storage.server.ts'
import { QUICK_SEARCH_LIMIT } from '@/config/quick-search.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type {
    QuickSearchEntity,
    QuickSearchInput,
} from '@/lib/QuickSearch/Types/quick-search.types.ts'
import {
    getQuickSearchPattern,
    quickSearchInputSchema,
} from '@/lib/QuickSearch/quickSearchValidation.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'

import { asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { certificateJobs, hostDomains, proxyHosts } from '@/db/schema.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { ProxyRuntimeMutationStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import { reconcileProxyConfigurationWithAudit } from '@/server/ProxyRuntime/proxy-runtime.service.ts'
import {
    readProxyHostHttpSettingsMap,
    readProxyHostHttpSettings,
    lockProxyRuntimeSettings,
    writeProxyHostHttpSettings,
} from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { validateCertificateAssignmentInTransaction } from '@/server/Admin/CertificateManagement/certificates.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { proxyHostIdInputSchema } from '@/features/Admin/ProxyHostManagement/validation.ts'
import type {
    CreateProxyHostInput,
    UpdateProxyHostInput,
} from '@/features/Admin/ProxyHostManagement/Types/validation.types.ts'
import { mapProxyHostDomainUniqueViolation, ProxyHostDomainError } from './proxy-hosts.errors.ts'
import { validateTrustedCaAssignmentInTransaction } from '@/server/Admin/TrustedCaManagement/trusted-cas.service.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { recordMutationFailureBestEffort } from '@/server/ProxyRuntime/audit-mutation.ts'
import { certificateJobSummary } from './certificate-jobs.storage.server.ts'
import {
    assertDiscoveryHostEditable,
    readDiscoveryRegistry,
} from '@/server/Admin/DockerDiscovery/discovery-storage.server.ts'
import {
    createProxyHostInTransaction,
    parseCreateProxyHostInput,
    parseUpdateProxyHostInput,
    loadProxyHostForUpdate,
    toProxyHostSummary,
    updateProxyHostInTransaction,
} from './proxy-hosts.mutations.server.ts'

function invalidInput(): ProxyHostDomainError {
    return new ProxyHostDomainError('invalid_input', 'Proxy host input is invalid.')
}
async function loadProxyHostDomainsInTransaction(
    transaction: AuthTransaction,
    proxyHostId: string,
): Promise<Array<string>> {
    const rows = await transaction
        .select({ domain: hostDomains.domain })
        .from(hostDomains)
        .where(eq(hostDomains.proxyHostId, proxyHostId))
        .orderBy(asc(hostDomains.domain))

    return rows.map((row) => row.domain)
}

function parseProxyHostId(proxyHostId: string): string {
    const parsed = proxyHostIdInputSchema.safeParse({ proxyHostId })

    if (!parsed.success) {
        throw invalidInput()
    }

    return parsed.data.proxyHostId
}

export async function readProxyHostSummariesInTransaction(
    transaction: AuthTransaction,
    ids?: readonly string[],
): Promise<Array<ProxyHostSummary>> {
    if (ids?.length === 0) return []
    const rows = await transaction
        .select({ ...proxyHostSummaryColumns, domain: hostDomains.domain })
        .from(proxyHosts)
        .leftJoin(hostDomains, eq(hostDomains.proxyHostId, proxyHosts.id))
        .where(ids ? inArray(proxyHosts.id, [...ids]) : undefined)
        .orderBy(asc(proxyHosts.id), asc(hostDomains.domain))
    const summaries = new Map<string, ProxyHostSummary>()

    for (const row of rows) {
        const existing = summaries.get(row.id)

        if (existing) {
            if (row.domain) {
                existing.domains.push(row.domain)
            }
            continue
        }

        summaries.set(row.id, toProxyHostSummary(row, row.domain ? [row.domain] : []))
    }

    const result: Array<ProxyHostSummary> = []

    const latestJobs = new Map<string, ReturnType<typeof certificateJobSummary>>()
    const hostIds = [...summaries.keys()]
    if (hostIds.length > 0) {
        const jobs = await transaction
            .selectDistinctOn([certificateJobs.proxyHostId])
            .from(certificateJobs)
            .where(inArray(certificateJobs.proxyHostId, hostIds))
            .orderBy(
                asc(certificateJobs.proxyHostId),
                desc(certificateJobs.createdAt),
                desc(certificateJobs.id),
            )
        for (const job of jobs) {
            if (job.proxyHostId && !latestJobs.has(job.proxyHostId)) {
                latestJobs.set(job.proxyHostId, certificateJobSummary(job))
            }
        }
    }

    const httpSettings = await readProxyHostHttpSettingsMap(transaction, hostIds)
    const responseCacheSettings = await readResponseCacheSettingsMap(transaction, hostIds)
    const registry = await readDiscoveryRegistry(transaction)
    const ownersByHost = new Map<string, (typeof registry.owners)[number]>()
    for (const owner of registry.owners) {
        if (owner.state !== 'detached' && !ownersByHost.has(owner.hostId))
            ownersByHost.set(owner.hostId, owner)
    }
    for (const summary of summaries.values()) {
        const owner = ownersByHost.get(summary.id)
        result.push({
            ...toProxyHostSummary(summary, summary.domains),
            responseCompression: httpSettings.get(summary.id)?.responseCompression ?? null,
            browserCache: httpSettings.get(summary.id)?.browserCache,
            ...(responseCacheSettings.has(summary.id)
                ? { responseCache: responseCacheSettings.get(summary.id)! }
                : {}),
            certificateJob: latestJobs.get(summary.id) ?? null,
            ...(owner && owner.state !== 'detached' ? { discovery: { state: owner.state } } : {}),
        })
    }

    return result
}

export async function getProxyHostsService(): Promise<Array<ProxyHostSummary>> {
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
    return getAuthDatabase().transaction(
        async (transaction) => {
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.PROXY_HOSTS_VIEW,
            )
            const state = await readHostTags(transaction, 'proxy')
            const hosts = await readProxyHostSummariesInTransaction(transaction)
            return hosts.map((host) =>
                Object.assign({}, host, { tags: tagsForHost(state, host.id) }),
            )
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
}

export async function createProxyHostService(
    input: CreateProxyHostInput,
): Promise<ProxyHostMutationSummary> {
    const parsedInput = parseCreateProxyHostInput(input)
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_CREATE)

    let saved: ProxyHostSummary
    try {
        saved = await getAuthDatabase().transaction((transaction) =>
            createProxyHostInTransaction(transaction, actor.id, parsedInput),
        )
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: 'create',
            resource: 'proxy-host',
            targetId: null,
            error,
        })
        const domainConflict = mapProxyHostDomainUniqueViolation(error)

        if (domainConflict) {
            throw domainConflict
        }

        throw error
    }
    return { ...saved, runtimeStatus: await reconcileProxyConfigurationWithAudit(actor.id) }
}

export async function updateProxyHostService(
    input: UpdateProxyHostInput,
): Promise<ProxyHostMutationSummary> {
    const parsedInput = parseUpdateProxyHostInput(input)
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)

    let saved: ProxyHostSummary
    try {
        saved = await getAuthDatabase().transaction((transaction) =>
            updateProxyHostInTransaction(transaction, actor.id, parsedInput),
        )
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: 'update',
            resource: 'proxy-host',
            targetId: parsedInput.proxyHostId,
            error,
        })
        const domainConflict = mapProxyHostDomainUniqueViolation(error)

        if (domainConflict) {
            throw domainConflict
        }

        throw error
    }
    return { ...saved, runtimeStatus: await reconcileProxyConfigurationWithAudit(actor.id) }
}

export async function deleteProxyHostService(
    proxyHostId: string,
): Promise<{ readonly runtimeStatus: ProxyRuntimeMutationStatus }> {
    const id = parseProxyHostId(proxyHostId)
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_DELETE)

    try {
        await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.PROXY_HOSTS_DELETE,
            )
            const proxyHost = await loadProxyHostForUpdate(transaction, id)

            if (!proxyHost) {
                throw new ProxyHostDomainError('proxy_host_not_found', 'Proxy host was not found.')
            }

            await writeProxyHostHttpSettings(transaction, proxyHost.id, {})
            await writeResponseCacheSettings(transaction, proxyHost.id, null)
            await assertDiscoveryHostEditable(transaction, proxyHost.id)
            await assignHostTagsInTransaction(transaction, 'proxy', proxyHost.id, [])
            await transaction.delete(proxyHosts).where(eq(proxyHosts.id, proxyHost.id))
            await appendAuditEventInTransactionService(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: 'delete',
                resource: 'proxy-host',
                targetId: proxyHost.id,
                result: 'success',
            })
        })
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: 'delete',
            resource: 'proxy-host',
            targetId: id,
            error,
        })
        throw error
    }

    return { runtimeStatus: await reconcileProxyConfigurationWithAudit(actor.id) }
}

async function setProxyHostEnabledService(
    proxyHostId: string,
    enabled: boolean,
): Promise<ProxyHostMutationSummary> {
    const id = parseProxyHostId(proxyHostId)
    const permission = enabled ? PERMISSIONS.PROXY_HOSTS_ENABLE : PERMISSIONS.PROXY_HOSTS_DISABLE
    const actor = await requirePermissionService(permission)

    let saved: ProxyHostSummary
    try {
        saved = await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(transaction, actor.id, permission)
            const proxyHost = await loadProxyHostForUpdate(transaction, id)

            if (!proxyHost) {
                throw new ProxyHostDomainError('proxy_host_not_found', 'Proxy host was not found.')
            }

            if (proxyHost.enabled === enabled) {
                throw new ProxyHostDomainError(
                    'invalid_status_transition',
                    'Proxy host already has the requested status.',
                )
            }

            const domains = await loadProxyHostDomainsInTransaction(transaction, proxyHost.id)
            if (enabled) {
                await validateTrustedCaAssignmentInTransaction(transaction, proxyHost.trustedCaId)
                await validateCertificateAssignmentInTransaction(
                    transaction,
                    proxyHost.certificateId,
                    proxyHost.forceHttps,
                    domains,
                )
            }
            const rows = await transaction
                .update(proxyHosts)
                .set({ enabled, updatedAt: new Date() })
                .where(eq(proxyHosts.id, proxyHost.id))
                .returning(proxyHostSummaryColumns)
            const updatedProxyHost = rows.at(0)

            if (!updatedProxyHost) {
                throw new ProxyHostDomainError('proxy_host_not_found', 'Proxy host was not found.')
            }

            await appendAuditEventInTransactionService(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: enabled ? 'enable' : 'disable',
                resource: 'proxy-host',
                targetId: proxyHost.id,
                result: 'success',
            })

            const savedHttpSettings = await readProxyHostHttpSettings(transaction, id)
            const responseCache =
                (await readResponseCacheSettingsMap(transaction, [id])).get(id) ?? null
            return {
                ...toProxyHostSummary(updatedProxyHost, domains),
                responseCompression: savedHttpSettings.responseCompression ?? null,
                browserCache: savedHttpSettings.browserCache,
                ...(responseCache ? { responseCache } : {}),
            }
        })
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: enabled ? 'enable' : 'disable',
            resource: 'proxy-host',
            targetId: id,
            error,
        })
        throw error
    }

    return { ...saved, runtimeStatus: await reconcileProxyConfigurationWithAudit(actor.id) }
}

export function enableProxyHostService(proxyHostId: string): Promise<ProxyHostMutationSummary> {
    return setProxyHostEnabledService(proxyHostId, true)
}

export function disableProxyHostService(proxyHostId: string): Promise<ProxyHostMutationSummary> {
    return setProxyHostEnabledService(proxyHostId, false)
}

export async function searchProxyHostsService(
    actor: AuthenticatedUser,
    input: QuickSearchInput,
): Promise<Array<QuickSearchEntity>> {
    if (!actor.permissions.includes(PERMISSIONS.PROXY_HOSTS_VIEW)) {
        throw new AuthDomainError('permission_denied', 'Permission is required.')
    }
    const currentActor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
    if (currentActor.id !== actor.id) {
        throw new AuthDomainError('permission_denied', 'Permission is required.')
    }
    const parsed = quickSearchInputSchema.safeParse(input)
    if (!parsed.success) {
        throw invalidInput()
    }
    const pattern = getQuickSearchPattern(parsed.data.query)
    return getAuthDatabase()
        .select({
            id: proxyHosts.id,
            label: sql<string>`coalesce((select ${hostDomains.domain} from ${hostDomains} where ${hostDomains.proxyHostId} = ${proxyHosts.id} order by ${hostDomains.domain} limit 1), '')`,
            detail: sql<string>`${proxyHosts.forwardScheme} || '://' || ${proxyHosts.forwardHost} || ':' || ${proxyHosts.forwardPort}`,
        })
        .from(proxyHosts)
        .where(
            parsed.data.id
                ? eq(proxyHosts.id, parsed.data.id)
                : sql`exists (select 1 from ${hostDomains} where ${hostDomains.proxyHostId} = ${proxyHosts.id} and ${hostDomains.domain} ilike ${pattern} escape '\\') or (${proxyHosts.forwardScheme} || '://' || ${proxyHosts.forwardHost} || ':' || ${proxyHosts.forwardPort}) ilike ${pattern} escape '\\'`,
        )
        .orderBy(asc(proxyHosts.id))
        .limit(parsed.data.id ? 1 : QUICK_SEARCH_LIMIT)
}

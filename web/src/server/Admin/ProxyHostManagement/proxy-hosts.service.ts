import '@tanstack/react-start/server-only'

import { asc, desc, eq, inArray } from 'drizzle-orm'

import { PERMISSIONS } from '../../../config/permissions.config'
import { certificateJobs, hostDomains, proxyHosts } from '../../../db/schema'
import type { ProxyHostSummary } from '../../../shared/Types/proxy-hosts.types'
import type { ProxyRuntimeMutationStatus } from '../../../shared/Types/proxy-runtime.types'
import { reconcileProxyConfigurationWithAudit } from '../../ProxyRuntime/proxy-runtime.service'
import {
    lockProxyRuntimeSettings,
    writeProxyHostHttpSettings,
} from '../../ProxyRuntime/proxy-runtime-settings'
import { requirePermissionService } from '../../Auth/Access/authorization.service'
import { validateCertificateAssignmentInTransaction } from '../CertificateManagement/certificates.service'
import { requirePermissionInTransaction } from '../../Auth/Access/rbac.service'
import { getAuthDatabase, type AuthTransaction } from '../../Auth/Core/database.server'
import {
    createProxyHostInputSchema,
    proxyHostIdInputSchema,
    updateProxyHostInputSchema,
    type CreateProxyHostInput,
    type UpdateProxyHostInput,
} from '../../../features/Admin/ProxyHostManagement/validation'
import { mapProxyHostDomainUniqueViolation, ProxyHostDomainError } from './proxy-hosts.errors'
import { validateTrustedCaAssignmentInTransaction } from '../TrustedCaManagement/trusted-cas.service'
import { appendAuditEventInTransaction } from '../../Audit/audit.service'
import { recordMutationFailureBestEffort } from '../../ProxyRuntime/audit-mutation'
import { certificateJobSummary } from './certificate-jobs.storage.server'
import {
    createProxyHostInTransaction,
    loadProxyHostForUpdate,
    toProxyHostSummary,
    updateProxyHostInTransaction,
} from './proxy-hosts.mutations.server'

export type ProxyHostMutationSummary = ProxyHostSummary & {
    readonly runtimeStatus: ProxyRuntimeMutationStatus
}

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

function parseCreateInput(input: CreateProxyHostInput) {
    const parsed = createProxyHostInputSchema.safeParse(input)

    if (!parsed.success) {
        throw invalidInput()
    }

    return parsed.data
}

function parseUpdateInput(input: UpdateProxyHostInput) {
    const parsed = updateProxyHostInputSchema.safeParse(input)

    if (!parsed.success) {
        throw invalidInput()
    }

    return parsed.data
}

function parseProxyHostId(proxyHostId: string): string {
    const parsed = proxyHostIdInputSchema.safeParse({ proxyHostId })

    if (!parsed.success) {
        throw invalidInput()
    }

    return parsed.data.proxyHostId
}

export async function getProxyHostsService(): Promise<Array<ProxyHostSummary>> {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
    const rows = await getAuthDatabase()
        .select({
            createdAt: proxyHosts.createdAt,
            domain: hostDomains.domain,
            enabled: proxyHosts.enabled,
            certificateId: proxyHosts.certificateId,
            forceHttps: proxyHosts.forceHttps,
            verifyUpstreamTls: proxyHosts.verifyUpstreamTls,
            upstreamTlsServerName: proxyHosts.upstreamTlsServerName,
            trustedCaId: proxyHosts.trustedCaId,
            accessPolicyId: proxyHosts.accessPolicyId,
            forwardHost: proxyHosts.forwardHost,
            forwardPort: proxyHosts.forwardPort,
            forwardScheme: proxyHosts.forwardScheme,
            id: proxyHosts.id,
            updatedAt: proxyHosts.updatedAt,
        })
        .from(proxyHosts)
        .leftJoin(hostDomains, eq(hostDomains.proxyHostId, proxyHosts.id))
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

        summaries.set(
            row.id,
            toProxyHostSummary(
                {
                    createdAt: row.createdAt,
                    enabled: row.enabled,
                    certificateId: row.certificateId,
                    forceHttps: row.forceHttps,
                    verifyUpstreamTls: row.verifyUpstreamTls,
                    upstreamTlsServerName: row.upstreamTlsServerName,
                    trustedCaId: row.trustedCaId,
                    accessPolicyId: row.accessPolicyId,
                    forwardHost: row.forwardHost,
                    forwardPort: row.forwardPort,
                    forwardScheme: row.forwardScheme,
                    id: row.id,
                    updatedAt: row.updatedAt,
                },
                row.domain ? [row.domain] : [],
            ),
        )
    }

    const result: Array<ProxyHostSummary> = []

    const latestJobs = new Map<string, ReturnType<typeof certificateJobSummary>>()
    const hostIds = [...summaries.keys()]
    if (hostIds.length > 0) {
        const jobs = await getAuthDatabase()
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

    for (const summary of summaries.values()) {
        result.push({
            ...toProxyHostSummary(summary, summary.domains),
            certificateJob: latestJobs.get(summary.id) ?? null,
        })
    }

    return result
}

export async function createProxyHostService(
    input: CreateProxyHostInput,
): Promise<ProxyHostMutationSummary> {
    const parsedInput = parseCreateInput(input)
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
    const parsedInput = parseUpdateInput(input)
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
            await transaction.delete(proxyHosts).where(eq(proxyHosts.id, proxyHost.id))
            await appendAuditEventInTransaction(transaction, {
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
                .returning({
                    createdAt: proxyHosts.createdAt,
                    enabled: proxyHosts.enabled,
                    certificateId: proxyHosts.certificateId,
                    forceHttps: proxyHosts.forceHttps,
                    verifyUpstreamTls: proxyHosts.verifyUpstreamTls,
                    upstreamTlsServerName: proxyHosts.upstreamTlsServerName,
                    trustedCaId: proxyHosts.trustedCaId,
                    accessPolicyId: proxyHosts.accessPolicyId,
                    forwardHost: proxyHosts.forwardHost,
                    forwardPort: proxyHosts.forwardPort,
                    forwardScheme: proxyHosts.forwardScheme,
                    id: proxyHosts.id,
                    updatedAt: proxyHosts.updatedAt,
                })
            const updatedProxyHost = rows.at(0)

            if (!updatedProxyHost) {
                throw new ProxyHostDomainError('proxy_host_not_found', 'Proxy host was not found.')
            }

            await appendAuditEventInTransaction(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: enabled ? 'enable' : 'disable',
                resource: 'proxy-host',
                targetId: proxyHost.id,
                result: 'success',
            })

            return toProxyHostSummary(updatedProxyHost, domains)
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

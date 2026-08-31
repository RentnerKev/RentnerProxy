import '@tanstack/react-start/server-only'

import { and, asc, eq, inArray, ne } from 'drizzle-orm'

import { PERMISSIONS } from '../../../config/permissions.config'
import { proxyHostDomains, proxyHosts } from '../../../db/schema'
import type { ProxyHostSummary } from '../../../shared/Types/proxy-hosts.types'
import type { ProxyRuntimeMutationStatus } from '../../../shared/Types/proxy-runtime.types'
import { reconcileProxyConfigurationService } from '../../ProxyRuntime/proxy-runtime.service'
import {
    lockProxyRuntimeSettings,
    writeProxyHostHttpSettings,
} from '../../ProxyRuntime/proxy-runtime-settings'
import { requirePermissionService } from '../../Auth/Access/authorization.service'
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

export type ProxyHostMutationSummary = ProxyHostSummary & {
    readonly runtimeStatus: ProxyRuntimeMutationStatus
}

type ProxyHostRow = {
    id: string
    forwardScheme: 'http' | 'https'
    forwardHost: string
    forwardPort: number
    enabled: boolean
    createdAt: Date
    updatedAt: Date
}

function invalidInput(): ProxyHostDomainError {
    return new ProxyHostDomainError('invalid_input', 'Proxy host input is invalid.')
}

function toProxyHostSummary(
    proxyHost: ProxyHostRow,
    domains: ReadonlyArray<string>,
): ProxyHostSummary {
    return {
        createdAt: proxyHost.createdAt,
        domains: domains.toSorted(),
        enabled: proxyHost.enabled,
        forwardHost: proxyHost.forwardHost,
        forwardPort: proxyHost.forwardPort,
        forwardScheme: proxyHost.forwardScheme,
        id: proxyHost.id,
        updatedAt: proxyHost.updatedAt,
    }
}

async function loadProxyHostForUpdate(
    transaction: AuthTransaction,
    proxyHostId: string,
): Promise<ProxyHostRow | null> {
    const rows = await transaction
        .select({
            createdAt: proxyHosts.createdAt,
            enabled: proxyHosts.enabled,
            forwardHost: proxyHosts.forwardHost,
            forwardPort: proxyHosts.forwardPort,
            forwardScheme: proxyHosts.forwardScheme,
            id: proxyHosts.id,
            updatedAt: proxyHosts.updatedAt,
        })
        .from(proxyHosts)
        .where(eq(proxyHosts.id, proxyHostId))
        .limit(1)
        .for('update')

    return rows.at(0) ?? null
}

async function loadProxyHostDomainsInTransaction(
    transaction: AuthTransaction,
    proxyHostId: string,
): Promise<Array<string>> {
    const rows = await transaction
        .select({ domain: proxyHostDomains.domain })
        .from(proxyHostDomains)
        .where(eq(proxyHostDomains.proxyHostId, proxyHostId))
        .orderBy(asc(proxyHostDomains.domain))

    return rows.map((row) => row.domain)
}

async function assertDomainsAvailableInTransaction(
    transaction: AuthTransaction,
    domains: ReadonlyArray<string>,
    currentProxyHostId?: string,
): Promise<void> {
    const condition = currentProxyHostId
        ? and(
              inArray(proxyHostDomains.domain, domains),
              ne(proxyHostDomains.proxyHostId, currentProxyHostId),
          )
        : inArray(proxyHostDomains.domain, domains)
    const conflicts = await transaction
        .select({ domain: proxyHostDomains.domain })
        .from(proxyHostDomains)
        .where(condition)
        .limit(1)

    if (conflicts.length > 0) {
        throw new ProxyHostDomainError('domain_conflict', 'A proxy host domain is already in use.')
    }
}

async function replaceDomainsInTransaction(
    transaction: AuthTransaction,
    proxyHostId: string,
    domains: ReadonlyArray<string>,
): Promise<void> {
    await transaction.delete(proxyHostDomains).where(eq(proxyHostDomains.proxyHostId, proxyHostId))
    await transaction
        .insert(proxyHostDomains)
        .values(domains.toSorted().map((domain) => ({ domain, proxyHostId })))
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
            domain: proxyHostDomains.domain,
            enabled: proxyHosts.enabled,
            forwardHost: proxyHosts.forwardHost,
            forwardPort: proxyHosts.forwardPort,
            forwardScheme: proxyHosts.forwardScheme,
            id: proxyHosts.id,
            updatedAt: proxyHosts.updatedAt,
        })
        .from(proxyHosts)
        .leftJoin(proxyHostDomains, eq(proxyHostDomains.proxyHostId, proxyHosts.id))
        .orderBy(asc(proxyHosts.id), asc(proxyHostDomains.domain))
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

    for (const summary of summaries.values()) {
        result.push(toProxyHostSummary(summary, summary.domains))
    }

    return result
}

export async function createProxyHostService(
    input: CreateProxyHostInput,
): Promise<ProxyHostMutationSummary> {
    const parsedInput = parseCreateInput(input)
    const domains = parsedInput.domains.toSorted()
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_CREATE)

    try {
        const saved = await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.PROXY_HOSTS_CREATE,
            )
            await assertDomainsAvailableInTransaction(transaction, domains)
            const rows = await transaction
                .insert(proxyHosts)
                .values({
                    enabled: parsedInput.enabled,
                    forwardHost: parsedInput.forwardHost,
                    forwardPort: parsedInput.forwardPort,
                    forwardScheme: parsedInput.forwardScheme,
                })
                .returning({
                    createdAt: proxyHosts.createdAt,
                    enabled: proxyHosts.enabled,
                    forwardHost: proxyHosts.forwardHost,
                    forwardPort: proxyHosts.forwardPort,
                    forwardScheme: proxyHosts.forwardScheme,
                    id: proxyHosts.id,
                    updatedAt: proxyHosts.updatedAt,
                })
            const proxyHost = rows.at(0)

            if (!proxyHost) {
                throw new ProxyHostDomainError('invalid_input', 'Proxy host could not be created.')
            }

            await transaction
                .insert(proxyHostDomains)
                .values(domains.map((domain) => ({ domain, proxyHostId: proxyHost.id })))

            return toProxyHostSummary(proxyHost, domains)
        })

        return { ...saved, runtimeStatus: await reconcileProxyConfigurationService() }
    } catch (error) {
        const domainConflict = mapProxyHostDomainUniqueViolation(error)

        if (domainConflict) {
            throw domainConflict
        }

        throw error
    }
}

export async function updateProxyHostService(
    input: UpdateProxyHostInput,
): Promise<ProxyHostMutationSummary> {
    const parsedInput = parseUpdateInput(input)
    const domains = parsedInput.domains.toSorted()
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)

    try {
        const saved = await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.PROXY_HOSTS_UPDATE,
            )
            const proxyHost = await loadProxyHostForUpdate(transaction, parsedInput.proxyHostId)

            if (!proxyHost) {
                throw new ProxyHostDomainError('proxy_host_not_found', 'Proxy host was not found.')
            }

            if (parsedInput.enabled !== proxyHost.enabled) {
                await requirePermissionInTransaction(
                    transaction,
                    actor.id,
                    parsedInput.enabled
                        ? PERMISSIONS.PROXY_HOSTS_ENABLE
                        : PERMISSIONS.PROXY_HOSTS_DISABLE,
                )
            }

            await assertDomainsAvailableInTransaction(transaction, domains, proxyHost.id)
            const rows = await transaction
                .update(proxyHosts)
                .set({
                    enabled: parsedInput.enabled,
                    forwardHost: parsedInput.forwardHost,
                    forwardPort: parsedInput.forwardPort,
                    forwardScheme: parsedInput.forwardScheme,
                    updatedAt: new Date(),
                })
                .where(eq(proxyHosts.id, proxyHost.id))
                .returning({
                    createdAt: proxyHosts.createdAt,
                    enabled: proxyHosts.enabled,
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

            await replaceDomainsInTransaction(transaction, proxyHost.id, domains)

            return toProxyHostSummary(updatedProxyHost, domains)
        })

        return { ...saved, runtimeStatus: await reconcileProxyConfigurationService() }
    } catch (error) {
        const domainConflict = mapProxyHostDomainUniqueViolation(error)

        if (domainConflict) {
            throw domainConflict
        }

        throw error
    }
}

export async function deleteProxyHostService(
    proxyHostId: string,
): Promise<{ readonly runtimeStatus: ProxyRuntimeMutationStatus }> {
    const id = parseProxyHostId(proxyHostId)
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_DELETE)

    await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(transaction, actor.id, PERMISSIONS.PROXY_HOSTS_DELETE)
        const proxyHost = await loadProxyHostForUpdate(transaction, id)

        if (!proxyHost) {
            throw new ProxyHostDomainError('proxy_host_not_found', 'Proxy host was not found.')
        }

        await writeProxyHostHttpSettings(transaction, proxyHost.id, {})
        await transaction.delete(proxyHosts).where(eq(proxyHosts.id, proxyHost.id))
    })

    return { runtimeStatus: await reconcileProxyConfigurationService() }
}

async function setProxyHostEnabledService(
    proxyHostId: string,
    enabled: boolean,
): Promise<ProxyHostMutationSummary> {
    const id = parseProxyHostId(proxyHostId)
    const permission = enabled ? PERMISSIONS.PROXY_HOSTS_ENABLE : PERMISSIONS.PROXY_HOSTS_DISABLE
    const actor = await requirePermissionService(permission)

    const saved = await getAuthDatabase().transaction(async (transaction) => {
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

        const rows = await transaction
            .update(proxyHosts)
            .set({ enabled, updatedAt: new Date() })
            .where(eq(proxyHosts.id, proxyHost.id))
            .returning({
                createdAt: proxyHosts.createdAt,
                enabled: proxyHosts.enabled,
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

        return toProxyHostSummary(
            updatedProxyHost,
            await loadProxyHostDomainsInTransaction(transaction, proxyHost.id),
        )
    })

    return { ...saved, runtimeStatus: await reconcileProxyConfigurationService() }
}

export function enableProxyHostService(proxyHostId: string): Promise<ProxyHostMutationSummary> {
    return setProxyHostEnabledService(proxyHostId, true)
}

export function disableProxyHostService(proxyHostId: string): Promise<ProxyHostMutationSummary> {
    return setProxyHostEnabledService(proxyHostId, false)
}

import '@tanstack/react-start/server-only'

import { and, asc, eq, inArray, isNotNull, ne, or } from 'drizzle-orm'

import type { RedirectHostStatusCode } from '../../../config/redirect-hosts.config'
import { PERMISSIONS } from '../../../config/permissions.config'
import { hostDomains, redirectHosts } from '../../../db/schema'
import type { RedirectHostSummary } from '../../../shared/Types/redirect-hosts.types'
import type { ProxyRuntimeMutationStatus } from '../../../shared/Types/proxy-runtime.types'
import { requirePermissionService } from '../../Auth/Access/authorization.service'
import { requirePermissionInTransaction } from '../../Auth/Access/rbac.service'
import { getAuthDatabase, type AuthTransaction } from '../../Auth/Core/database.server'
import { reconcileProxyConfigurationService } from '../../ProxyRuntime/proxy-runtime.service'
import { lockProxyRuntimeSettings } from '../../ProxyRuntime/proxy-runtime-settings'
import { validateCertificateAssignmentInTransaction } from '../CertificateManagement/certificates.service'
import {
    createRedirectHostInputSchema,
    redirectHostIdInputSchema,
    updateRedirectHostInputSchema,
    type CreateRedirectHostInput,
    type UpdateRedirectHostInput,
} from '../../../features/Admin/RedirectHostManagement/validation'
import {
    mapRedirectHostDomainUniqueViolation,
    RedirectHostDomainError,
} from './redirect-hosts.errors'

export type RedirectHostMutationSummary = RedirectHostSummary & {
    readonly runtimeStatus: ProxyRuntimeMutationStatus
}

type RedirectHostRow = {
    id: string
    destination: string
    statusCode: RedirectHostStatusCode
    preserveRequestUri: boolean
    enabled: boolean
    certificateId: string | null
    createdAt: Date
    updatedAt: Date
}

function invalidInput(): RedirectHostDomainError {
    return new RedirectHostDomainError('invalid_input', 'Redirect host input is invalid.')
}

function toRedirectHostSummary(
    redirectHost: RedirectHostRow,
    domains: ReadonlyArray<string>,
): RedirectHostSummary {
    return {
        createdAt: redirectHost.createdAt,
        destination: redirectHost.destination,
        domains: domains.toSorted(),
        enabled: redirectHost.enabled,
        certificateId: redirectHost.certificateId,
        id: redirectHost.id,
        preserveRequestUri: redirectHost.preserveRequestUri,
        statusCode: redirectHost.statusCode,
        updatedAt: redirectHost.updatedAt,
    }
}

async function loadRedirectHostForUpdate(
    transaction: AuthTransaction,
    redirectHostId: string,
): Promise<RedirectHostRow | null> {
    const rows = await transaction
        .select({
            createdAt: redirectHosts.createdAt,
            destination: redirectHosts.destination,
            enabled: redirectHosts.enabled,
            certificateId: redirectHosts.certificateId,
            id: redirectHosts.id,
            preserveRequestUri: redirectHosts.preserveRequestUri,
            statusCode: redirectHosts.statusCode,
            updatedAt: redirectHosts.updatedAt,
        })
        .from(redirectHosts)
        .where(eq(redirectHosts.id, redirectHostId))
        .limit(1)
        .for('update')

    return rows.at(0) ?? null
}

async function loadRedirectHostDomainsInTransaction(
    transaction: AuthTransaction,
    redirectHostId: string,
): Promise<Array<string>> {
    const rows = await transaction
        .select({ domain: hostDomains.domain })
        .from(hostDomains)
        .where(eq(hostDomains.redirectHostId, redirectHostId))
        .orderBy(asc(hostDomains.domain))

    return rows.map((row) => row.domain)
}

async function assertDomainsAvailableInTransaction(
    transaction: AuthTransaction,
    domains: ReadonlyArray<string>,
    currentRedirectHostId?: string,
): Promise<void> {
    const condition = currentRedirectHostId
        ? and(
              inArray(hostDomains.domain, domains),
              or(
                  isNotNull(hostDomains.proxyHostId),
                  and(
                      isNotNull(hostDomains.redirectHostId),
                      ne(hostDomains.redirectHostId, currentRedirectHostId),
                  ),
              ),
          )
        : inArray(hostDomains.domain, domains)
    const conflicts = await transaction
        .select({ domain: hostDomains.domain })
        .from(hostDomains)
        .where(condition)
        .limit(1)

    if (conflicts.length > 0) {
        throw new RedirectHostDomainError(
            'domain_conflict',
            'A redirect host domain is already in use.',
        )
    }
}

async function replaceDomainsInTransaction(
    transaction: AuthTransaction,
    redirectHostId: string,
    domains: ReadonlyArray<string>,
): Promise<void> {
    await transaction.delete(hostDomains).where(eq(hostDomains.redirectHostId, redirectHostId))
    await transaction
        .insert(hostDomains)
        .values(domains.toSorted().map((domain) => ({ domain, redirectHostId })))
}

function parseCreateInput(input: CreateRedirectHostInput) {
    const parsed = createRedirectHostInputSchema.safeParse(input)
    if (!parsed.success) throw invalidInput()
    return parsed.data
}

function parseUpdateInput(input: UpdateRedirectHostInput) {
    const parsed = updateRedirectHostInputSchema.safeParse(input)
    if (!parsed.success) throw invalidInput()
    return parsed.data
}

function parseRedirectHostId(redirectHostId: string): string {
    const parsed = redirectHostIdInputSchema.safeParse({ redirectHostId })
    if (!parsed.success) throw invalidInput()
    return parsed.data.redirectHostId
}

export async function getRedirectHostsService(): Promise<Array<RedirectHostSummary>> {
    await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_VIEW)
    const rows = await getAuthDatabase()
        .select({
            createdAt: redirectHosts.createdAt,
            destination: redirectHosts.destination,
            domain: hostDomains.domain,
            enabled: redirectHosts.enabled,
            certificateId: redirectHosts.certificateId,
            id: redirectHosts.id,
            preserveRequestUri: redirectHosts.preserveRequestUri,
            statusCode: redirectHosts.statusCode,
            updatedAt: redirectHosts.updatedAt,
        })
        .from(redirectHosts)
        .leftJoin(hostDomains, eq(hostDomains.redirectHostId, redirectHosts.id))
        .orderBy(asc(redirectHosts.id), asc(hostDomains.domain))
    const summaries = new Map<string, RedirectHostSummary>()

    for (const row of rows) {
        const existing = summaries.get(row.id)
        if (existing) {
            if (row.domain) existing.domains.push(row.domain)
            continue
        }
        summaries.set(
            row.id,
            toRedirectHostSummary(
                {
                    createdAt: row.createdAt,
                    destination: row.destination,
                    enabled: row.enabled,
                    certificateId: row.certificateId,
                    id: row.id,
                    preserveRequestUri: row.preserveRequestUri,
                    statusCode: row.statusCode,
                    updatedAt: row.updatedAt,
                },
                row.domain ? [row.domain] : [],
            ),
        )
    }

    return [...summaries.values()].map((summary) => toRedirectHostSummary(summary, summary.domains))
}

export async function createRedirectHostService(
    input: CreateRedirectHostInput,
): Promise<RedirectHostMutationSummary> {
    const parsedInput = parseCreateInput(input)
    const domains = parsedInput.domains.toSorted()
    const actor = await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_CREATE)

    try {
        const saved = await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.REDIRECT_HOSTS_CREATE,
            )
            await assertDomainsAvailableInTransaction(transaction, domains)
            const certificateId = parsedInput.certificateId?.toLowerCase() ?? null
            await validateCertificateAssignmentInTransaction(
                transaction,
                certificateId,
                false,
                domains,
            )
            const rows = await transaction
                .insert(redirectHosts)
                .values({
                    destination: parsedInput.destination,
                    statusCode: parsedInput.statusCode,
                    preserveRequestUri: parsedInput.preserveRequestUri,
                    enabled: parsedInput.enabled,
                    certificateId,
                })
                .returning()
            const redirectHost = rows.at(0)
            if (!redirectHost)
                throw new RedirectHostDomainError(
                    'invalid_input',
                    'Redirect host could not be created.',
                )
            await transaction
                .insert(hostDomains)
                .values(domains.map((domain) => ({ domain, redirectHostId: redirectHost.id })))
            return toRedirectHostSummary(redirectHost, domains)
        })
        return { ...saved, runtimeStatus: await reconcileProxyConfigurationService() }
    } catch (error) {
        const domainConflict = mapRedirectHostDomainUniqueViolation(error)
        if (domainConflict) throw domainConflict
        throw error
    }
}

export async function updateRedirectHostService(
    input: UpdateRedirectHostInput,
): Promise<RedirectHostMutationSummary> {
    const parsedInput = parseUpdateInput(input)
    const domains = parsedInput.domains.toSorted()
    const actor = await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_UPDATE)

    try {
        const saved = await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.REDIRECT_HOSTS_UPDATE,
            )
            const redirectHost = await loadRedirectHostForUpdate(
                transaction,
                parsedInput.redirectHostId,
            )
            if (!redirectHost)
                throw new RedirectHostDomainError('host_not_found', 'Redirect host was not found.')
            if (parsedInput.enabled !== redirectHost.enabled) {
                await requirePermissionInTransaction(
                    transaction,
                    actor.id,
                    parsedInput.enabled
                        ? PERMISSIONS.REDIRECT_HOSTS_ENABLE
                        : PERMISSIONS.REDIRECT_HOSTS_DISABLE,
                )
            }
            await assertDomainsAvailableInTransaction(transaction, domains, redirectHost.id)
            const certificateId =
                parsedInput.certificateId === undefined
                    ? redirectHost.certificateId
                    : (parsedInput.certificateId?.toLowerCase() ?? null)
            await validateCertificateAssignmentInTransaction(
                transaction,
                certificateId,
                false,
                domains,
            )
            const rows = await transaction
                .update(redirectHosts)
                .set({
                    destination: parsedInput.destination,
                    statusCode: parsedInput.statusCode,
                    preserveRequestUri: parsedInput.preserveRequestUri,
                    enabled: parsedInput.enabled,
                    certificateId,
                    updatedAt: new Date(),
                })
                .where(eq(redirectHosts.id, redirectHost.id))
                .returning()
            const updated = rows.at(0)
            if (!updated)
                throw new RedirectHostDomainError('host_not_found', 'Redirect host was not found.')
            await replaceDomainsInTransaction(transaction, redirectHost.id, domains)
            return toRedirectHostSummary(updated, domains)
        })
        return { ...saved, runtimeStatus: await reconcileProxyConfigurationService() }
    } catch (error) {
        const domainConflict = mapRedirectHostDomainUniqueViolation(error)
        if (domainConflict) throw domainConflict
        throw error
    }
}

export async function deleteRedirectHostService(
    redirectHostId: string,
): Promise<{ readonly runtimeStatus: ProxyRuntimeMutationStatus }> {
    const id = parseRedirectHostId(redirectHostId)
    const actor = await requirePermissionService(PERMISSIONS.REDIRECT_HOSTS_DELETE)
    await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(
            transaction,
            actor.id,
            PERMISSIONS.REDIRECT_HOSTS_DELETE,
        )
        const redirectHost = await loadRedirectHostForUpdate(transaction, id)
        if (!redirectHost)
            throw new RedirectHostDomainError('host_not_found', 'Redirect host was not found.')
        await transaction.delete(redirectHosts).where(eq(redirectHosts.id, redirectHost.id))
    })
    return { runtimeStatus: await reconcileProxyConfigurationService() }
}

async function setRedirectHostEnabledService(
    redirectHostId: string,
    enabled: boolean,
): Promise<RedirectHostMutationSummary> {
    const id = parseRedirectHostId(redirectHostId)
    const permission = enabled
        ? PERMISSIONS.REDIRECT_HOSTS_ENABLE
        : PERMISSIONS.REDIRECT_HOSTS_DISABLE
    const actor = await requirePermissionService(permission)
    const saved = await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(transaction, actor.id, permission)
        const redirectHost = await loadRedirectHostForUpdate(transaction, id)
        if (!redirectHost)
            throw new RedirectHostDomainError('host_not_found', 'Redirect host was not found.')
        if (redirectHost.enabled === enabled)
            throw new RedirectHostDomainError(
                'invalid_status_transition',
                'Redirect host already has the requested status.',
            )
        const domains = await loadRedirectHostDomainsInTransaction(transaction, redirectHost.id)
        if (enabled)
            await validateCertificateAssignmentInTransaction(
                transaction,
                redirectHost.certificateId,
                false,
                domains,
            )
        const rows = await transaction
            .update(redirectHosts)
            .set({ enabled, updatedAt: new Date() })
            .where(eq(redirectHosts.id, redirectHost.id))
            .returning()
        const updated = rows.at(0)
        if (!updated)
            throw new RedirectHostDomainError('host_not_found', 'Redirect host was not found.')
        return toRedirectHostSummary(updated, domains)
    })
    return { ...saved, runtimeStatus: await reconcileProxyConfigurationService() }
}

export function enableRedirectHostService(
    redirectHostId: string,
): Promise<RedirectHostMutationSummary> {
    return setRedirectHostEnabledService(redirectHostId, true)
}

export function disableRedirectHostService(
    redirectHostId: string,
): Promise<RedirectHostMutationSummary> {
    return setRedirectHostEnabledService(redirectHostId, false)
}

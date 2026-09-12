import '@tanstack/react-start/server-only'

import { and, eq, inArray, isNotNull, ne, or } from 'drizzle-orm'

import { PERMISSIONS } from '../../../config/permissions.config'
import { accessPolicies, hostDomains, proxyHosts } from '../../../db/schema'
import type { ProxyHostSummary } from '../../../shared/Types/proxy-hosts.types'
import { lockProxyRuntimeSettings } from '../../ProxyRuntime/proxy-runtime-settings'
import { requirePermissionInTransaction } from '../../Auth/Access/rbac.service'
import type { AuthTransaction } from '../../Auth/Core/database.server'
import {
    createProxyHostInputSchema,
    updateProxyHostInputSchema,
    type CreateProxyHostInput,
    type UpdateProxyHostInput,
} from '../../../features/Admin/ProxyHostManagement/validation'
import { ProxyHostDomainError } from './proxy-hosts.errors'
import { normalizeUpstreamTlsSettings } from './upstream-tls.service'
import { validateTrustedCaAssignmentInTransaction } from '../TrustedCaManagement/trusted-cas.service'
import { validateCertificateAssignmentInTransaction } from '../CertificateManagement/certificates.service'
import { appendAuditEventInTransaction } from '../../Audit/audit.service'

type ProxyHostRow = {
    id: string
    forwardScheme: 'http' | 'https'
    forwardHost: string
    forwardPort: number
    enabled: boolean
    certificateId: string | null
    forceHttps: boolean
    verifyUpstreamTls: boolean
    upstreamTlsServerName: string | null
    trustedCaId: string | null
    accessPolicyId?: string | null
    createdAt: Date
    updatedAt: Date
}

function invalidInput(): ProxyHostDomainError {
    return new ProxyHostDomainError('invalid_input', 'Proxy host input is invalid.')
}

export function toProxyHostSummary(
    proxyHost: ProxyHostRow,
    domains: ReadonlyArray<string>,
): ProxyHostSummary {
    return {
        createdAt: proxyHost.createdAt,
        domains: domains.toSorted(),
        enabled: proxyHost.enabled,
        certificateId: proxyHost.certificateId,
        forceHttps: proxyHost.forceHttps,
        verifyUpstreamTls: proxyHost.verifyUpstreamTls,
        upstreamTlsServerName: proxyHost.upstreamTlsServerName,
        trustedCaId: proxyHost.trustedCaId,
        accessPolicyId: proxyHost.accessPolicyId ?? null,
        forwardHost: proxyHost.forwardHost,
        forwardPort: proxyHost.forwardPort,
        forwardScheme: proxyHost.forwardScheme,
        id: proxyHost.id,
        updatedAt: proxyHost.updatedAt,
    }
}

export async function loadProxyHostForUpdate(
    transaction: AuthTransaction,
    proxyHostId: string,
): Promise<ProxyHostRow | null> {
    const rows = await transaction
        .select({
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
        .from(proxyHosts)
        .where(eq(proxyHosts.id, proxyHostId))
        .limit(1)
        .for('update')

    return rows.at(0) ?? null
}

async function assertDomainsAvailableInTransaction(
    transaction: AuthTransaction,
    domains: ReadonlyArray<string>,
    currentProxyHostId?: string,
): Promise<void> {
    const condition = currentProxyHostId
        ? and(
              inArray(hostDomains.domain, domains),
              or(
                  isNotNull(hostDomains.redirectHostId),
                  and(
                      isNotNull(hostDomains.proxyHostId),
                      ne(hostDomains.proxyHostId, currentProxyHostId),
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
        throw new ProxyHostDomainError('domain_conflict', 'A proxy host domain is already in use.')
    }
}

async function replaceDomainsInTransaction(
    transaction: AuthTransaction,
    proxyHostId: string,
    domains: ReadonlyArray<string>,
): Promise<void> {
    await transaction.delete(hostDomains).where(eq(hostDomains.proxyHostId, proxyHostId))
    await transaction
        .insert(hostDomains)
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

export async function createProxyHostInTransaction(
    transaction: AuthTransaction,
    actorId: string,
    input: CreateProxyHostInput,
): Promise<ProxyHostSummary> {
    const parsedInput = parseCreateInput(input)
    const domains = parsedInput.domains.toSorted()
    await lockProxyRuntimeSettings(transaction)
    await requirePermissionInTransaction(transaction, actorId, PERMISSIONS.PROXY_HOSTS_CREATE)
    await assertDomainsAvailableInTransaction(transaction, domains)
    const certificateId = parsedInput.certificateId?.toLowerCase() ?? null
    const forceHttps = parsedInput.forceHttps ?? false
    const upstreamTls = normalizeUpstreamTlsSettings(parsedInput)
    const accessPolicyId = parsedInput.accessPolicyId?.toLowerCase() ?? null
    if (accessPolicyId) {
        await requirePermissionInTransaction(
            transaction,
            actorId,
            PERMISSIONS.ACCESS_POLICIES_ASSIGN,
        )
        const policy = await transaction
            .select({ id: accessPolicies.id })
            .from(accessPolicies)
            .where(eq(accessPolicies.id, accessPolicyId))
            .limit(1)
        if (!policy.at(0)) {
            throw new ProxyHostDomainError('invalid_input', 'Access policy was not found.')
        }
    }
    await validateTrustedCaAssignmentInTransaction(transaction, upstreamTls.trustedCaId)
    await validateCertificateAssignmentInTransaction(
        transaction,
        certificateId,
        forceHttps,
        domains,
    )
    const rows = await transaction
        .insert(proxyHosts)
        .values({
            enabled: parsedInput.enabled,
            certificateId,
            forceHttps,
            ...upstreamTls,
            accessPolicyId,
            forwardHost: parsedInput.forwardHost,
            forwardPort: parsedInput.forwardPort,
            forwardScheme: parsedInput.forwardScheme,
        })
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
    const proxyHost = rows.at(0)

    if (!proxyHost) {
        throw new ProxyHostDomainError('invalid_input', 'Proxy host could not be created.')
    }

    await transaction
        .insert(hostDomains)
        .values(domains.map((domain) => ({ domain, proxyHostId: proxyHost.id })))

    await appendAuditEventInTransaction(transaction, {
        actorUserId: actorId,
        actorKind: 'user',
        action: 'create',
        resource: 'proxy-host',
        targetId: proxyHost.id,
        result: 'success',
    })

    return toProxyHostSummary(proxyHost, domains)
}

export async function updateProxyHostInTransaction(
    transaction: AuthTransaction,
    actorId: string,
    input: UpdateProxyHostInput,
): Promise<ProxyHostSummary> {
    const parsedInput = parseUpdateInput(input)
    const domains = parsedInput.domains.toSorted()
    await lockProxyRuntimeSettings(transaction)
    await requirePermissionInTransaction(transaction, actorId, PERMISSIONS.PROXY_HOSTS_UPDATE)
    const proxyHost = await loadProxyHostForUpdate(transaction, parsedInput.proxyHostId)

    if (!proxyHost) {
        throw new ProxyHostDomainError('proxy_host_not_found', 'Proxy host was not found.')
    }

    if (parsedInput.enabled !== proxyHost.enabled) {
        await requirePermissionInTransaction(
            transaction,
            actorId,
            parsedInput.enabled ? PERMISSIONS.PROXY_HOSTS_ENABLE : PERMISSIONS.PROXY_HOSTS_DISABLE,
        )
    }

    await assertDomainsAvailableInTransaction(transaction, domains, proxyHost.id)
    const certificateId =
        parsedInput.certificateId === undefined
            ? proxyHost.certificateId
            : (parsedInput.certificateId?.toLowerCase() ?? null)
    const forceHttps = parsedInput.forceHttps ?? proxyHost.forceHttps
    const upstreamTls = normalizeUpstreamTlsSettings(parsedInput, proxyHost)
    const accessPolicyId =
        parsedInput.accessPolicyId === undefined
            ? proxyHost.accessPolicyId
            : (parsedInput.accessPolicyId?.toLowerCase() ?? null)
    if (accessPolicyId) {
        if (accessPolicyId !== proxyHost.accessPolicyId) {
            await requirePermissionInTransaction(
                transaction,
                actorId,
                PERMISSIONS.ACCESS_POLICIES_ASSIGN,
            )
        }
        const policy = await transaction
            .select({ id: accessPolicies.id })
            .from(accessPolicies)
            .where(eq(accessPolicies.id, accessPolicyId))
            .limit(1)
        if (!policy.at(0)) {
            throw new ProxyHostDomainError('invalid_input', 'Access policy was not found.')
        }
    } else if (parsedInput.accessPolicyId !== undefined && proxyHost.accessPolicyId !== null) {
        await requirePermissionInTransaction(
            transaction,
            actorId,
            PERMISSIONS.ACCESS_POLICIES_ASSIGN,
        )
    }
    await validateTrustedCaAssignmentInTransaction(transaction, upstreamTls.trustedCaId)
    await validateCertificateAssignmentInTransaction(
        transaction,
        certificateId,
        forceHttps,
        domains,
    )
    const rows = await transaction
        .update(proxyHosts)
        .set({
            enabled: parsedInput.enabled,
            certificateId,
            forceHttps,
            ...upstreamTls,
            accessPolicyId,
            forwardHost: parsedInput.forwardHost,
            forwardPort: parsedInput.forwardPort,
            forwardScheme: parsedInput.forwardScheme,
            updatedAt: new Date(),
        })
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

    await replaceDomainsInTransaction(transaction, proxyHost.id, domains)

    await appendAuditEventInTransaction(transaction, {
        actorUserId: actorId,
        actorKind: 'user',
        action: 'update',
        resource: 'proxy-host',
        targetId: proxyHost.id,
        result: 'success',
        metadata: {
            changedFields: [
                'domains',
                'upstream',
                'tls',
                ...(parsedInput.certificateId === undefined ? [] : (['certificate'] as const)),
                ...(parsedInput.trustedCaId === undefined ? [] : (['trustedCa'] as const)),
                ...(parsedInput.enabled === proxyHost.enabled ? [] : (['status'] as const)),
                ...(accessPolicyId === proxyHost.accessPolicyId ? [] : (['accessPolicy'] as const)),
            ],
            ...(accessPolicyId === proxyHost.accessPolicyId
                ? {}
                : {
                      assigned: accessPolicyId !== null,
                      previousId: proxyHost.accessPolicyId,
                      nextId: accessPolicyId,
                  }),
        },
    })

    return toProxyHostSummary(updatedProxyHost, domains)
}

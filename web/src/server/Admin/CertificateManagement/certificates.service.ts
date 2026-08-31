import '@tanstack/react-start/server-only'

import { and, asc, count, eq, inArray, notInArray } from 'drizzle-orm'
import type { z } from 'zod'
import { PERMISSIONS, type PermissionKey } from '../../../config/permissions.config'
import { certificates, certificateDomains, proxyHosts, proxyHostDomains } from '../../../db/schema'
import {
    certificateIdInputSchema,
    importCertificateInputSchema,
    replaceCertificateInputSchema,
    requestCertificateInputSchema,
    type ImportCertificateInput,
    type ReplaceCertificateInput,
    type RequestCertificateInput,
} from '../../../features/Admin/CertificateManagement/validation'
import {
    certificateCoversDomains,
    getCertificateStatus,
} from '../../../features/Admin/CertificateManagement/Helpers/certificateValidation'
import type { CertificateSummary } from '../../../shared/Types/certificates.types'
import {
    requirePermissionService,
    requireUserService,
} from '../../Auth/Access/authorization.service'
import { requirePermissionInTransaction } from '../../Auth/Access/rbac.service'
import { getAuthDatabase, type AuthTransaction } from '../../Auth/Core/database.server'
import { AuthDomainError } from '../../Auth/Core/errors.server'
import {
    deleteControllerCertificate,
    getControllerCertificate,
    getControllerCertificates,
    importControllerCertificate,
    issueControllerCertificate,
    renewControllerCertificate,
    type ControllerCertificateMetadata,
} from '../../Foundation/certificates.server'
import { lockProxyRuntimeSettings } from '../../ProxyRuntime/proxy-runtime-settings'
import { CertificateDomainError } from './certificates.errors'

type CertificateRow = typeof certificates.$inferSelect

function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw new CertificateDomainError('invalid_input')
    return parsed.data
}

function parseId(certificateId: string): string {
    return parseInput(certificateIdInputSchema, { certificateId }).certificateId.toLowerCase()
}

async function getCertificateRow(
    transaction: AuthTransaction,
    certificateId: string,
): Promise<CertificateRow> {
    const [row] = await transaction
        .select()
        .from(certificates)
        .where(eq(certificates.id, certificateId))
        .limit(1)
        .for('update')
    if (!row) throw new CertificateDomainError('certificate_not_found')
    return row
}

async function persistControllerMetadata(
    transaction: AuthTransaction,
    metadata: ControllerCertificateMetadata,
): Promise<void> {
    const row = await getCertificateRow(transaction, metadata.id)
    if (row.source !== metadata.source || row.environment !== metadata.environment) {
        throw new CertificateDomainError('controller_unavailable')
    }
    const issuedAt = metadata.issuedAt ? new Date(metadata.issuedAt) : null
    const expiresAt = metadata.expiresAt ? new Date(metadata.expiresAt) : null
    const domains = [...new Set(metadata.domains)].toSorted()
    const existingDomains = (
        await transaction
            .select({ domain: certificateDomains.domain })
            .from(certificateDomains)
            .where(eq(certificateDomains.certificateId, row.id))
            .orderBy(asc(certificateDomains.domain))
    ).map((entry) => entry.domain)
    const domainsChanged = JSON.stringify(existingDomains) !== JSON.stringify(domains)
    const changed =
        row.status !== metadata.status ||
        row.operation !== metadata.operation ||
        row.fingerprint !== metadata.fingerprint ||
        row.lastErrorCode !== metadata.lastErrorCode ||
        row.issuer !== metadata.issuer ||
        row.issuedAt?.getTime() !== issuedAt?.getTime() ||
        row.expiresAt?.getTime() !== expiresAt?.getTime() ||
        domainsChanged
    if (!changed) return
    await transaction
        .update(certificates)
        .set({
            status: metadata.status,
            operation: metadata.operation,
            issuedAt,
            expiresAt,
            issuer: metadata.issuer,
            fingerprint: metadata.fingerprint,
            lastErrorCode: metadata.lastErrorCode,
            updatedAt: new Date(),
        })
        .where(eq(certificates.id, row.id))
    if (domainsChanged) {
        await transaction
            .delete(certificateDomains)
            .where(eq(certificateDomains.certificateId, row.id))
        if (domains.length > 0) {
            await transaction.insert(certificateDomains).values(
                domains.map((domain) => ({
                    certificateId: row.id,
                    domain,
                })),
            )
        }
    }
}

async function readCertificateSummaries(): Promise<CertificateSummary[]> {
    const database = getAuthDatabase()
    return database.transaction(
        async (transaction) => {
            // One consistent metadata snapshot; serial reads use the same reserved SQL connection.
            const rows = await transaction
                .select()
                .from(certificates)
                .orderBy(asc(certificates.createdAt), asc(certificates.id))
            const domains = await transaction
                .select()
                .from(certificateDomains)
                .orderBy(asc(certificateDomains.domain))
            const assignments = await transaction
                .select({ certificateId: proxyHosts.certificateId, count: count() })
                .from(proxyHosts)
                .groupBy(proxyHosts.certificateId)
            const domainsByCertificate = new Map<string, string[]>()
            for (const { certificateId, domain } of domains) {
                const entries = domainsByCertificate.get(certificateId) ?? []
                entries.push(domain)
                domainsByCertificate.set(certificateId, entries)
            }
            const counts = new Map(assignments.map((entry) => [entry.certificateId, entry.count]))
            return rows.map((row) => ({
                id: row.id,
                name: row.name,
                domains: domainsByCertificate.get(row.id) ?? [],
                source: row.source,
                environment: row.environment,
                status: getCertificateStatus(row.status, row.issuedAt, row.expiresAt),
                operation: row.operation,
                issuedAt: row.issuedAt,
                expiresAt: row.expiresAt,
                issuer: row.issuer,
                fingerprint: row.fingerprint,
                lastErrorCode: row.lastErrorCode,
                assignedHostCount: counts.get(row.id) ?? 0,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
            }))
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
}

async function synchronizeCertificateMetadata(
    actorId: string,
    permission: PermissionKey,
): Promise<void> {
    await getAuthDatabase().transaction(async (transaction) => {
        // Use the existing mutation lock so stale polling cannot overwrite a just-replaced certificate.
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(transaction, actorId, permission)
        let metadata: ControllerCertificateMetadata[]
        try {
            metadata = await getControllerCertificates()
        } catch (error) {
            if (error instanceof CertificateDomainError) return
            throw error
        }
        // A successful authoritative listing can reveal interrupted deletion or lost local material.
        // Keep the DB record and assignments for recovery; never silently downgrade a host to HTTP.
        await transaction
            .update(certificates)
            .set({
                status: 'failed',
                operation: 'idle',
                lastErrorCode: 'certificate_not_found',
                updatedAt: new Date(),
            })
            .where(
                metadata.length === 0
                    ? eq(certificates.status, 'valid')
                    : and(
                          eq(certificates.status, 'valid'),
                          notInArray(
                              certificates.id,
                              metadata.map((entry) => entry.id),
                          ),
                      ),
            )
        if (metadata.length === 0) return
        const known = await transaction
            .select({ id: certificates.id })
            .from(certificates)
            .where(
                inArray(
                    certificates.id,
                    metadata.map((certificate) => certificate.id),
                ),
            )
        const ids = new Set(known.map((row) => row.id))
        for (const certificate of metadata) {
            // oxlint-disable-next-line no-await-in-loop -- Ordered writes share one SQL transaction and runtime lock.
            if (ids.has(certificate.id)) await persistControllerMetadata(transaction, certificate)
        }
    })
}

export async function getCertificatesService(): Promise<CertificateSummary[]> {
    const actor = await requirePermissionService(PERMISSIONS.CERTIFICATES_VIEW)
    await synchronizeCertificateMetadata(actor.id, PERMISSIONS.CERTIFICATES_VIEW)
    return readCertificateSummaries()
}

export async function getAssignableCertificatesService(): Promise<CertificateSummary[]> {
    const actor = await requireUserService()
    const permission = actor.permissions.includes(PERMISSIONS.PROXY_HOSTS_UPDATE)
        ? PERMISSIONS.PROXY_HOSTS_UPDATE
        : PERMISSIONS.PROXY_HOSTS_CREATE
    if (!actor.permissions.includes(permission))
        throw new AuthDomainError('permission_denied', 'Permission is required.')
    await synchronizeCertificateMetadata(actor.id, permission)
    return readCertificateSummaries()
}

export async function getCertificateDetailsService(
    certificateId: string,
): Promise<CertificateSummary> {
    const id = parseId(certificateId)
    const certificate = (await getCertificatesService()).find((entry) => entry.id === id)
    if (!certificate) throw new CertificateDomainError('certificate_not_found')
    return certificate
}

async function createPendingCertificate(
    actorId: string,
    permission: PermissionKey,
    input: {
        name: string
        source: 'manual' | 'acme'
        environment: 'staging' | 'production' | null
        domains: string[]
    },
): Promise<string> {
    return getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(transaction, actorId, permission)
        const [created] = await transaction
            .insert(certificates)
            .values({
                name: input.name,
                source: input.source,
                environment: input.environment,
            })
            .returning({ id: certificates.id })
        if (!created) throw new CertificateDomainError('certificate_store_unavailable')
        if (input.domains.length > 0) {
            await transaction.insert(certificateDomains).values(
                input.domains.map((domain) => ({
                    certificateId: created.id,
                    domain,
                })),
            )
        }
        return created.id
    })
}

async function markCertificateFailure(certificateId: string, error: unknown): Promise<void> {
    const code = error instanceof CertificateDomainError ? error.code : 'controller_unavailable'
    await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        const row = await getCertificateRow(transaction, certificateId)
        // A rejected replacement never invalidates existing material, including a concurrent success.
        if (row.status === 'valid') return
        await transaction
            .update(certificates)
            .set({
                status: 'failed',
                operation: 'idle',
                lastErrorCode: code,
                updatedAt: new Date(),
            })
            .where(eq(certificates.id, certificateId))
    })
}

async function requiredCertificateDomains(
    transaction: AuthTransaction,
    certificateId: string,
): Promise<string[]> {
    const rows = await transaction
        .select({ domain: proxyHostDomains.domain })
        .from(proxyHosts)
        .innerJoin(proxyHostDomains, eq(proxyHostDomains.proxyHostId, proxyHosts.id))
        .where(eq(proxyHosts.certificateId, certificateId))
    return [...new Set(rows.map((row) => row.domain))].toSorted()
}

async function importCertificateMaterial(
    actorId: string,
    permission: PermissionKey,
    certificateId: string,
    input: ImportCertificateInput,
): Promise<string> {
    let submitted = false
    try {
        await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(transaction, actorId, permission)
            const current = await getCertificateRow(transaction, certificateId)
            if (current.source !== 'manual') throw new CertificateDomainError('invalid_input')
            const requiredDomains = await requiredCertificateDomains(transaction, certificateId)
            submitted = true
            const metadata = await importControllerCertificate(
                certificateId,
                input,
                requiredDomains,
            )
            await persistControllerMetadata(transaction, metadata)
            await transaction
                .update(certificates)
                .set({ name: input.name, updatedAt: new Date() })
                .where(eq(certificates.id, certificateId))
        })
    } catch (error) {
        if (submitted && error instanceof CertificateDomainError)
            await markCertificateFailure(certificateId, error)
        throw error
    }
    return certificateId
}

export async function importCertificateService(input: ImportCertificateInput): Promise<string> {
    const actor = await requirePermissionService(PERMISSIONS.CERTIFICATES_CREATE)
    const parsed = parseInput(importCertificateInputSchema, input)
    const id = await createPendingCertificate(actor.id, PERMISSIONS.CERTIFICATES_CREATE, {
        name: parsed.name,
        source: 'manual',
        environment: null,
        domains: [],
    })
    return importCertificateMaterial(actor.id, PERMISSIONS.CERTIFICATES_CREATE, id, parsed)
}

export async function replaceCertificateService(input: ReplaceCertificateInput): Promise<string> {
    const actor = await requirePermissionService(PERMISSIONS.CERTIFICATES_UPDATE)
    const parsed = parseInput(replaceCertificateInputSchema, input)
    return importCertificateMaterial(
        actor.id,
        PERMISSIONS.CERTIFICATES_UPDATE,
        parsed.certificateId.toLowerCase(),
        parsed,
    )
}

export async function requestCertificateService(input: RequestCertificateInput): Promise<string> {
    const actor = await requirePermissionService(PERMISSIONS.CERTIFICATES_ISSUE)
    const parsed = parseInput(requestCertificateInputSchema, input)
    const id = await createPendingCertificate(actor.id, PERMISSIONS.CERTIFICATES_ISSUE, {
        name: parsed.name,
        source: 'acme',
        environment: parsed.environment,
        domains: parsed.domains,
    })
    try {
        await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.CERTIFICATES_ISSUE,
            )
            await persistControllerMetadata(
                transaction,
                await issueControllerCertificate(id, parsed),
            )
        })
    } catch (error) {
        if (error instanceof CertificateDomainError) await markCertificateFailure(id, error)
        throw error
    }
    return id
}

export async function renewCertificateService(certificateId: string): Promise<string> {
    const actor = await requirePermissionService(PERMISSIONS.CERTIFICATES_RENEW)
    const id = parseId(certificateId)
    await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(transaction, actor.id, PERMISSIONS.CERTIFICATES_RENEW)
        const row = await getCertificateRow(transaction, id)
        if (row.source !== 'acme') throw new CertificateDomainError('invalid_input')
        await persistControllerMetadata(transaction, await renewControllerCertificate(id))
    })
    return id
}

export async function deleteCertificateService(certificateId: string): Promise<void> {
    const actor = await requirePermissionService(PERMISSIONS.CERTIFICATES_DELETE)
    const id = parseId(certificateId)
    await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(transaction, actor.id, PERMISSIONS.CERTIFICATES_DELETE)
        await getCertificateRow(transaction, id)
        const assigned = await transaction
            .select({ id: proxyHosts.id })
            .from(proxyHosts)
            .where(eq(proxyHosts.certificateId, id))
            .limit(1)
        if (assigned.length > 0) throw new CertificateDomainError('certificate_in_use')
        await deleteControllerCertificate(id)
        await transaction.delete(certificates).where(eq(certificates.id, id))
    })
}

export async function validateCertificateAssignmentInTransaction(
    transaction: AuthTransaction,
    certificateId: string | null,
    forceHttps: boolean,
    domains: readonly string[],
): Promise<void> {
    if (!certificateId) {
        if (forceHttps) throw new CertificateDomainError('invalid_input')
        return
    }
    await getCertificateRow(transaction, certificateId)
    const metadata = await getControllerCertificate(certificateId)
    if (
        metadata.status !== 'valid' ||
        !metadata.issuedAt ||
        !metadata.expiresAt ||
        Date.parse(metadata.issuedAt) > Date.now() ||
        Date.parse(metadata.expiresAt) <= Date.now()
    ) {
        throw new CertificateDomainError('certificate_expired')
    }
    if (!certificateCoversDomains(metadata.domains, domains))
        throw new CertificateDomainError('domain_mismatch')
    await persistControllerMetadata(transaction, metadata)
}

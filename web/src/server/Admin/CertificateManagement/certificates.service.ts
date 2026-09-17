import '@tanstack/react-start/server-only'

import { and, asc, count, eq, inArray, notInArray } from 'drizzle-orm'
import type { z } from 'zod'
import { PERMISSIONS, type PermissionKey } from '../../../config/permissions.config'
import type { AuditEventInput } from '../../../shared/Types/audit-events.types'
import type { ProxyRuntimeMutationStatus } from '../../../shared/Types/proxy-runtime.types'
import {
    certificates,
    certificateJobs,
    certificateDomains,
    hostDomains,
    proxyHosts,
    redirectHosts,
} from '../../../db/schema'
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
import { reconcileProxyConfigurationWithAudit } from '../../ProxyRuntime/proxy-runtime.service'
import { CertificateDomainError } from './certificates.errors'
import {
    appendAuditEventInTransaction,
    appendAuditEventsInTransaction,
} from '../../Audit/audit.service'
import { recordMutationFailureBestEffort } from '../../ProxyRuntime/audit-mutation'

type CertificateRow = typeof certificates.$inferSelect

export interface DeleteCertificateResult {
    readonly deleted: boolean
    readonly detachedHostCount: number
    readonly runtimeStatus: ProxyRuntimeMutationStatus
}

interface CertificateDeletionRuntime {
    readonly reconcile: (actorId: string) => Promise<ProxyRuntimeMutationStatus>
}

const certificateDeletionRuntime: CertificateDeletionRuntime = {
    reconcile: reconcileProxyConfigurationWithAudit,
}

const CERTIFICATE_DETACH_AUDIT_BATCH_SIZE = 500

async function appendCertificateDetachAuditEvents(
    transaction: AuthTransaction,
    events: readonly AuditEventInput[],
    offset = 0,
): Promise<void> {
    if (offset >= events.length) return
    await appendAuditEventsInTransaction(
        transaction,
        events.slice(offset, offset + CERTIFICATE_DETACH_AUDIT_BATCH_SIZE),
    )
    await appendCertificateDetachAuditEvents(
        transaction,
        events,
        offset + CERTIFICATE_DETACH_AUDIT_BATCH_SIZE,
    )
}

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
    guardControllerTimestamp = false,
): Promise<void> {
    const row = await getCertificateRow(transaction, metadata.id)
    if (row.source !== metadata.source || row.environment !== metadata.environment) {
        throw new CertificateDomainError('controller_unavailable')
    }
    const controllerUpdatedAt = new Date(metadata.updatedAt)
    if (
        guardControllerTimestamp &&
        row.controllerUpdatedAt !== null &&
        controllerUpdatedAt.getTime() <= row.controllerUpdatedAt.getTime()
    )
        return
    const issuedAt = metadata.issuedAt ? new Date(metadata.issuedAt) : null
    const expiresAt = metadata.expiresAt ? new Date(metadata.expiresAt) : null
    const candidate =
        metadata.candidate === undefined
            ? row.candidate
            : metadata.candidate
              ? {
                    ...metadata.candidate,
                }
              : null
    const dnsCleanupPending = metadata.dnsCleanupPending ?? row.dnsCleanupPending
    const currentOperation =
        metadata.currentOperation === undefined
            ? row.currentOperation
            : metadata.currentOperation
              ? { ...metadata.currentOperation }
              : null
    const challengeType =
        metadata.challengeType === undefined ? row.challengeType : metadata.challengeType
    const lastActivatedAt =
        metadata.lastActivatedAt === undefined
            ? row.lastActivatedAt
            : metadata.lastActivatedAt === null
              ? null
              : new Date(metadata.lastActivatedAt)
    const lastErrorAt =
        metadata.lastErrorAt === undefined
            ? row.lastErrorAt
            : metadata.lastErrorAt === null
              ? null
              : new Date(metadata.lastErrorAt)
    const nextAttemptAt =
        metadata.nextAttemptAt === undefined
            ? row.nextAttemptAt
            : metadata.nextAttemptAt === null
              ? null
              : new Date(metadata.nextAttemptAt)
    const attemptCount =
        metadata.attemptCount === undefined ? row.attemptCount : metadata.attemptCount
    const lastAttemptAt =
        metadata.lastAttemptAt === undefined
            ? row.lastAttemptAt
            : metadata.lastAttemptAt === null
              ? null
              : new Date(metadata.lastAttemptAt)
    const lastSuccessAt =
        metadata.lastSuccessAt === undefined
            ? row.lastSuccessAt
            : metadata.lastSuccessAt === null
              ? null
              : new Date(metadata.lastSuccessAt)
    const nextRenewalAt =
        metadata.nextRenewalAt === undefined
            ? row.nextRenewalAt
            : metadata.nextRenewalAt === null
              ? null
              : new Date(metadata.nextRenewalAt)
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
        JSON.stringify(row.candidate) !== JSON.stringify(candidate) ||
        JSON.stringify(row.currentOperation) !== JSON.stringify(currentOperation) ||
        row.challengeType !== challengeType ||
        row.dnsCleanupPending !== dnsCleanupPending ||
        row.lastActivatedAt?.getTime() !== lastActivatedAt?.getTime() ||
        row.lastErrorAt?.getTime() !== lastErrorAt?.getTime() ||
        row.nextAttemptAt?.getTime() !== nextAttemptAt?.getTime() ||
        row.attemptCount !== attemptCount ||
        row.lastAttemptAt?.getTime() !== lastAttemptAt?.getTime() ||
        row.lastSuccessAt?.getTime() !== lastSuccessAt?.getTime() ||
        row.nextRenewalAt?.getTime() !== nextRenewalAt?.getTime() ||
        row.controllerUpdatedAt?.getTime() !== controllerUpdatedAt.getTime() ||
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
            candidate,
            currentOperation,
            challengeType,
            dnsCleanupPending,
            lastErrorCode: metadata.lastErrorCode,
            lastActivatedAt,
            lastErrorAt,
            nextAttemptAt,
            attemptCount,
            lastAttemptAt,
            lastSuccessAt,
            nextRenewalAt,
            controllerUpdatedAt,
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

export async function persistControllerCertificatesMetadataInTransaction(
    transaction: AuthTransaction,
    metadata: readonly ControllerCertificateMetadata[],
    markMissing = true,
): Promise<void> {
    if (markMissing) {
        await transaction
            .update(certificates)
            .set({
                status: 'failed',
                operation: 'idle',
                lastErrorCode: 'certificate_not_found',
                lastErrorAt: new Date(),
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
    }
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
        if (ids.has(certificate.id)) await persistControllerMetadata(transaction, certificate, true)
    }
}

async function readCertificateSummaries(): Promise<CertificateSummary[]> {
    const database = getAuthDatabase()
    return database.transaction(
        async (transaction) => {
            const rows = await transaction
                .select()
                .from(certificates)
                .orderBy(asc(certificates.createdAt), asc(certificates.id))
            const domains = await transaction
                .select()
                .from(certificateDomains)
                .orderBy(asc(certificateDomains.domain))
            const proxyAssignments = await transaction
                .select({ certificateId: proxyHosts.certificateId, count: count() })
                .from(proxyHosts)
                .groupBy(proxyHosts.certificateId)
            const redirectAssignments = await transaction
                .select({ certificateId: redirectHosts.certificateId, count: count() })
                .from(redirectHosts)
                .groupBy(redirectHosts.certificateId)
            const domainsByCertificate = new Map<string, string[]>()
            for (const { certificateId, domain } of domains) {
                const entries = domainsByCertificate.get(certificateId) ?? []
                entries.push(domain)
                domainsByCertificate.set(certificateId, entries)
            }
            const counts = new Map<string | null, number>()
            for (const entry of [...proxyAssignments, ...redirectAssignments]) {
                counts.set(
                    entry.certificateId,
                    (counts.get(entry.certificateId) ?? 0) + entry.count,
                )
            }
            return rows.map((row) => ({
                id: row.id,
                name: row.name,
                domains: domainsByCertificate.get(row.id) ?? [],
                source: row.source,
                environment: row.environment,
                status: getCertificateStatus(row.status, row.issuedAt, row.expiresAt),
                operation: row.operation,
                currentOperation: row.currentOperation
                    ? {
                          id: row.currentOperation.id,
                          kind: row.currentOperation.kind,
                          stage: row.currentOperation.stage,
                          startedAt: new Date(row.currentOperation.startedAt),
                          updatedAt: new Date(row.currentOperation.updatedAt),
                      }
                    : null,
                challengeType: row.challengeType,
                issuedAt: row.issuedAt,
                expiresAt: row.expiresAt,
                issuer: row.issuer,
                fingerprint: row.fingerprint,
                candidate: row.candidate
                    ? {
                          fingerprint: row.candidate.fingerprint,
                          issuedAt: new Date(row.candidate.issuedAt),
                          expiresAt: new Date(row.candidate.expiresAt),
                          lastErrorCode: row.candidate.lastErrorCode,
                          nextAttemptAt: row.candidate.nextAttemptAt
                              ? new Date(row.candidate.nextAttemptAt)
                              : null,
                      }
                    : null,
                dnsCleanupPending: row.dnsCleanupPending,
                lastErrorCode: row.lastErrorCode,
                lastActivatedAt: row.lastActivatedAt,
                lastErrorAt: row.lastErrorAt,
                nextAttemptAt: row.nextAttemptAt,
                attemptCount: row.attemptCount,
                lastAttemptAt: row.lastAttemptAt,
                lastSuccessAt: row.lastSuccessAt,
                nextRenewalAt: row.nextRenewalAt,
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
    let metadata: ControllerCertificateMetadata[]
    try {
        metadata = await getControllerCertificates()
    } catch {
        throw new CertificateDomainError('controller_unavailable')
    }
    await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(transaction, actorId, permission)
        await persistControllerCertificatesMetadataInTransaction(transaction, metadata)
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
        : actor.permissions.includes(PERMISSIONS.PROXY_HOSTS_CREATE)
          ? PERMISSIONS.PROXY_HOSTS_CREATE
          : actor.permissions.includes(PERMISSIONS.REDIRECT_HOSTS_UPDATE)
            ? PERMISSIONS.REDIRECT_HOSTS_UPDATE
            : PERMISSIONS.REDIRECT_HOSTS_CREATE
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
        await appendAuditEventInTransaction(transaction, {
            actorUserId: actorId,
            actorKind: 'user',
            action: 'create',
            resource: 'certificate',
            targetId: created.id,
            result: 'success',
        })
        return created.id
    })
}

async function markCertificateFailure(certificateId: string, error: unknown): Promise<void> {
    const code = error instanceof CertificateDomainError ? error.code : 'controller_unavailable'
    await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        const row = await getCertificateRow(transaction, certificateId)

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
    const proxyRows = await transaction
        .select({ domain: hostDomains.domain })
        .from(proxyHosts)
        .innerJoin(hostDomains, eq(hostDomains.proxyHostId, proxyHosts.id))
        .where(eq(proxyHosts.certificateId, certificateId))
    const redirectRows = await transaction
        .select({ domain: hostDomains.domain })
        .from(redirectHosts)
        .innerJoin(hostDomains, eq(hostDomains.redirectHostId, redirectHosts.id))
        .where(eq(redirectHosts.certificateId, certificateId))
    return [...new Set([...proxyRows, ...redirectRows].map((row) => row.domain))].toSorted()
}

async function importCertificateMaterial(
    actorId: string,
    permission: PermissionKey,
    certificateId: string,
    input: ImportCertificateInput,
    action: 'import' | 'replace',
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
            await appendAuditEventInTransaction(transaction, {
                actorUserId: actorId,
                actorKind: 'user',
                action,
                resource: 'certificate',
                targetId: certificateId,
                result: 'success',
            })
        })
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId,
            action,
            resource: 'certificate',
            targetId: certificateId,
            error,
        })
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
    return importCertificateMaterial(
        actor.id,
        PERMISSIONS.CERTIFICATES_CREATE,
        id,
        parsed,
        'import',
    )
}

export async function replaceCertificateService(input: ReplaceCertificateInput): Promise<string> {
    const actor = await requirePermissionService(PERMISSIONS.CERTIFICATES_UPDATE)
    const parsed = parseInput(replaceCertificateInputSchema, input)
    return importCertificateMaterial(
        actor.id,
        PERMISSIONS.CERTIFICATES_UPDATE,
        parsed.certificateId.toLowerCase(),
        parsed,
        'replace',
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
            await appendAuditEventInTransaction(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: 'request',
                resource: 'certificate',
                targetId: id,
                result: 'success',
            })
        })
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: 'request',
            resource: 'certificate',
            targetId: id,
            error,
        })
        if (error instanceof CertificateDomainError) await markCertificateFailure(id, error)
        throw error
    }
    return id
}

export async function renewCertificateService(certificateId: string): Promise<string> {
    const actor = await requirePermissionService(PERMISSIONS.CERTIFICATES_RENEW)
    const id = parseId(certificateId)
    try {
        await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.CERTIFICATES_RENEW,
            )
            const row = await getCertificateRow(transaction, id)
            if (row.source !== 'acme') throw new CertificateDomainError('invalid_input')
            await persistControllerMetadata(transaction, await renewControllerCertificate(id))
            await appendAuditEventInTransaction(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: 'renew',
                resource: 'certificate',
                targetId: id,
                result: 'success',
            })
        })
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: 'renew',
            resource: 'certificate',
            targetId: id,
            error,
        })
        throw error
    }
    return id
}

async function prepareCertificateForDeletion(
    transaction: AuthTransaction,
    certificateId: string,
): Promise<void> {
    const certificate = await getCertificateRow(transaction, certificateId)
    if (certificate.operation !== 'idle' || certificate.candidate !== null) {
        throw new CertificateDomainError('operation_in_progress')
    }
    const activeJobs = await transaction
        .select({
            id: certificateJobs.id,
            lastErrorCode: certificateJobs.lastErrorCode,
            leaseToken: certificateJobs.leaseToken,
        })
        .from(certificateJobs)
        .where(
            and(
                eq(certificateJobs.certificateId, certificateId),
                inArray(certificateJobs.stage, ['preparing', 'issuing', 'applying']),
            ),
        )
        .for('update')
    if (activeJobs.some((job) => !job.lastErrorCode || job.leaseToken !== null)) {
        throw new CertificateDomainError('operation_in_progress')
    }
    if (activeJobs.length > 0) {
        await transaction
            .update(certificateJobs)
            .set({ stage: 'failed', retryRequested: false, updatedAt: new Date() })
            .where(
                inArray(
                    certificateJobs.id,
                    activeJobs.map((job) => job.id),
                ),
            )
    }
}

async function readCertificateAssignmentsForUpdate(
    transaction: AuthTransaction,
    certificateId: string,
): Promise<{ readonly proxyHostIds: string[]; readonly redirectHostIds: string[] }> {
    const proxyAssignments = await transaction
        .select({ id: proxyHosts.id })
        .from(proxyHosts)
        .where(eq(proxyHosts.certificateId, certificateId))
        .for('update')
    const redirectAssignments = await transaction
        .select({ id: redirectHosts.id })
        .from(redirectHosts)
        .where(eq(redirectHosts.certificateId, certificateId))
        .for('update')
    return {
        proxyHostIds: proxyAssignments.map(({ id }) => id),
        redirectHostIds: redirectAssignments.map(({ id }) => id),
    }
}

async function detachCertificateAssignments(
    transaction: AuthTransaction,
    actorId: string,
    certificateId: string,
): Promise<number> {
    await prepareCertificateForDeletion(transaction, certificateId)
    const { proxyHostIds, redirectHostIds } = await readCertificateAssignmentsForUpdate(
        transaction,
        certificateId,
    )
    if (proxyHostIds.length > 0) {
        await requirePermissionInTransaction(transaction, actorId, PERMISSIONS.PROXY_HOSTS_UPDATE)
    }
    if (redirectHostIds.length > 0) {
        await requirePermissionInTransaction(
            transaction,
            actorId,
            PERMISSIONS.REDIRECT_HOSTS_UPDATE,
        )
    }
    const updatedAt = new Date()
    if (proxyHostIds.length > 0) {
        await transaction
            .update(proxyHosts)
            .set({ certificateId: null, forceHttps: false, updatedAt })
            .where(eq(proxyHosts.certificateId, certificateId))
    }
    if (redirectHostIds.length > 0) {
        await transaction
            .update(redirectHosts)
            .set({ certificateId: null, updatedAt })
            .where(eq(redirectHosts.certificateId, certificateId))
    }
    const auditEvents: AuditEventInput[] = [
        ...proxyHostIds.map((targetId) => ({
            actorUserId: actorId,
            actorKind: 'user' as const,
            action: 'update' as const,
            resource: 'proxy-host' as const,
            targetId,
            result: 'success' as const,
            metadata: { changedFields: ['certificate', 'tls'] as const },
        })),
        ...redirectHostIds.map((targetId) => ({
            actorUserId: actorId,
            actorKind: 'user' as const,
            action: 'update' as const,
            resource: 'redirect-host' as const,
            targetId,
            result: 'success' as const,
            metadata: { changedFields: ['certificate', 'tls'] as const },
        })),
    ]
    await appendCertificateDetachAuditEvents(transaction, auditEvents)
    return proxyHostIds.length + redirectHostIds.length
}

async function finalizeCertificateDeletion(
    actorId: string,
    certificateId: string,
): Promise<'deleted' | 'runtime_in_use'> {
    return getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(transaction, actorId, PERMISSIONS.CERTIFICATES_DELETE)
        await prepareCertificateForDeletion(transaction, certificateId)
        const assignments = await readCertificateAssignmentsForUpdate(transaction, certificateId)
        if (assignments.proxyHostIds.length > 0 || assignments.redirectHostIds.length > 0) {
            throw new CertificateDomainError('certificate_in_use')
        }
        try {
            await deleteControllerCertificate(certificateId)
        } catch (error) {
            if (error instanceof CertificateDomainError && error.code === 'certificate_in_use') {
                return 'runtime_in_use'
            }
            throw error
        }
        await transaction.delete(certificates).where(eq(certificates.id, certificateId))
        await appendAuditEventInTransaction(transaction, {
            actorUserId: actorId,
            actorKind: 'user',
            action: 'delete',
            resource: 'certificate',
            targetId: certificateId,
            result: 'success',
        })
        return 'deleted'
    })
}

export async function deleteCertificateService(
    certificateId: string,
    runtime: CertificateDeletionRuntime = certificateDeletionRuntime,
): Promise<DeleteCertificateResult> {
    const actor = await requirePermissionService(PERMISSIONS.CERTIFICATES_DELETE)
    const id = parseId(certificateId)
    try {
        const detachedHostCount = await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.CERTIFICATES_DELETE,
            )
            return detachCertificateAssignments(transaction, actor.id, id)
        })
        if (detachedHostCount === 0) {
            const finalization = await finalizeCertificateDeletion(actor.id, id)
            if (finalization === 'deleted') {
                return { deleted: true, detachedHostCount, runtimeStatus: 'applied' }
            }
        }
        const runtimeStatus = await runtime.reconcile(actor.id)
        if (runtimeStatus === 'pending') {
            return { deleted: false, detachedHostCount, runtimeStatus }
        }
        const finalization = await finalizeCertificateDeletion(actor.id, id)
        if (finalization === 'runtime_in_use') {
            throw new CertificateDomainError('certificate_in_use')
        }
        return { deleted: true, detachedHostCount, runtimeStatus }
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: 'delete',
            resource: 'certificate',
            targetId: id,
            error,
        })
        throw error
    }
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

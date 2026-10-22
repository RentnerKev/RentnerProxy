// oxlint-disable-next-line import/no-unassigned-import -- Metadata persistence must stay behind the server boundary.
import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { certificates, certificateDomains } from '@/db/schema.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { ControllerCertificateMetadata } from '@/server/Controller/Types/certificates.types.ts'
import type { CertificateRow } from './Types/certificates.types.ts'
import type { CertificateMetadataVersion } from './Types/certificate-metadata.types.ts'
import { CertificateDomainError } from './certificates.errors.ts'

export async function getCertificateRow(
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

export async function persistControllerMetadata(
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
    markMissing = false,
    validBeforeRead: readonly CertificateMetadataVersion[] = [],
): Promise<void> {
    const present = new Set(metadata.map((entry) => entry.id))
    const missing = markMissing ? validBeforeRead.filter((entry) => !present.has(entry.id)) : []
    if (missing.length > 0) {
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
                and(
                    eq(certificates.status, 'valid'),
                    sql`(${certificates.id}, ${certificates}.xmin::text) in (values ${sql.join(
                        missing.map((entry) => sql`(${entry.id}::uuid, ${entry.xmin}::text)`),
                        sql`, `,
                    )})`,
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

export async function captureValidCertificateVersions(
    database: Pick<AuthTransaction, 'select'>,
): Promise<CertificateMetadataVersion[]> {
    return database
        .select({ id: certificates.id, xmin: sql<string>`${certificates}.xmin::text` })
        .from(certificates)
        .where(eq(certificates.status, 'valid'))
        .orderBy(asc(certificates.id))
}

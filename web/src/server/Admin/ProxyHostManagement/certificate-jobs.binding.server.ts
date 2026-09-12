import '@tanstack/react-start/server-only'

import { and, eq, ne } from 'drizzle-orm'
import { certificateJobs, certificates, proxyHosts, redirectHosts } from '../../../db/schema'
import { certificateCoversDomains } from '../../../features/Admin/CertificateManagement/Helpers/certificateValidation'
import { getAuthDatabase } from '../../Auth/Core/database.server'
import { appendAuditEventInTransaction } from '../../Audit/audit.service'
import type { ControllerCertificateMetadata } from '../../Foundation/certificates.server'
import { getProxyRuntimeStatus } from '../../Foundation/controller.server'
import { readProxyRuntimeSnapshot } from '../../ProxyRuntime/proxy-runtime-data'
import { reconcileProxyConfigurationService } from '../../ProxyRuntime/proxy-runtime.service'
import { persistControllerCertificatesMetadataInTransaction } from '../CertificateManagement/certificates.service'
import {
    CertificateJobDomainError,
    readCertificateJobHost,
    validateCertificateJobContext,
    type CertificateJobRow,
} from './certificate-jobs.storage.server'
import { withCertificateJobClaim } from './certificate-jobs.lease.server'

export const certificateJobRuntime = {
    reconcile: reconcileProxyConfigurationService,
    status: getProxyRuntimeStatus,
}

export function validateIssuedJobCertificate(
    metadata: ControllerCertificateMetadata,
    job: CertificateJobRow,
): void {
    if (
        metadata.id !== job.certificateId ||
        metadata.source !== 'acme' ||
        metadata.status !== 'valid' ||
        !metadata.issuedAt ||
        !metadata.expiresAt ||
        Date.parse(metadata.issuedAt) > Date.now() ||
        Date.parse(metadata.expiresAt) <= Date.now()
    ) {
        throw new CertificateJobDomainError('certificate_expired')
    }
    if (!certificateCoversDomains(metadata.domains, job.domains))
        throw new CertificateJobDomainError('domain_mismatch')
}

export async function bindIssuedJobCertificate(
    job: CertificateJobRow,
    metadata: ControllerCertificateMetadata,
): Promise<boolean> {
    return (
        (await withCertificateJobClaim(job, async (transaction, current) => {
            const context = await validateCertificateJobContext(transaction, current)
            validateIssuedJobCertificate(metadata, current)
            const [certificate] = await transaction
                .select({ id: certificates.id })
                .from(certificates)
                .where(eq(certificates.id, metadata.id))
                .for('update')
            if (!certificate) throw new CertificateJobDomainError('certificate_deleted')
            const otherHosts = await transaction
                .select({ id: proxyHosts.id })
                .from(proxyHosts)
                .where(
                    and(
                        eq(proxyHosts.certificateId, metadata.id),
                        ne(proxyHosts.id, context.host.id),
                    ),
                )
                .limit(1)
            const otherRedirects = await transaction
                .select({ id: redirectHosts.id })
                .from(redirectHosts)
                .where(eq(redirectHosts.certificateId, metadata.id))
                .limit(1)
            if (otherHosts.length || otherRedirects.length)
                throw new CertificateJobDomainError('certificate_used_elsewhere')
            await persistControllerCertificatesMetadataInTransaction(transaction, [metadata], false)
            if (!current.assignedRevision) {
                await transaction
                    .update(proxyHosts)
                    .set({
                        certificateId: metadata.id,
                        enabled: current.desiredEnabled,
                        forceHttps: current.desiredForceHttps,
                        updatedAt: new Date(),
                    })
                    .where(eq(proxyHosts.id, context.host.id))
                const assigned = await readCertificateJobHost(transaction, context.host.id)
                await transaction
                    .update(certificateJobs)
                    .set({
                        stage: 'applying',
                        assignedRevision: assigned.revision,
                        controllerStage: metadata.currentOperation?.stage ?? null,
                        controllerOperationId: metadata.currentOperation?.id ?? null,
                        retryRequested: false,
                        lastErrorCode: null,
                        updatedAt: new Date(),
                    })
                    .where(eq(certificateJobs.id, current.id))
                await appendAuditEventInTransaction(transaction, {
                    actorUserId: current.actorUserId,
                    actorKind: 'user',
                    action: 'update',
                    resource: 'proxy-host',
                    targetId: context.host.id,
                    result: 'success',
                    metadata: { changedFields: ['certificate', 'tls', 'status'] },
                })
            }
            return true
        })) ?? false
    )
}

export async function confirmJobRuntime(
    job: CertificateJobRow,
    runtime = certificateJobRuntime,
): Promise<boolean> {
    await runtime.reconcile()
    const desired = await getAuthDatabase().transaction(
        (transaction) => readProxyRuntimeSnapshot(transaction),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
    const status = await runtime.status()
    if (!status?.available || !status.running || status.activeRevision !== desired.revision)
        return false
    return (
        (await withCertificateJobClaim(job, async (transaction, current) => {
            await validateCertificateJobContext(transaction, current)
            if (!current.assignedRevision) return false
            const latest = await readProxyRuntimeSnapshot(transaction)
            if (latest.revision !== status.activeRevision) return false
            await transaction
                .update(certificateJobs)
                .set({
                    stage: 'applied',
                    retryRequested: false,
                    lastErrorCode: null,
                    requestCiphertext: null,
                    requestIv: null,
                    leaseToken: null,
                    leaseExpiresAt: null,
                    updatedAt: new Date(),
                })
                .where(eq(certificateJobs.id, current.id))
            await appendAuditEventInTransaction(transaction, {
                actorUserId: current.actorUserId,
                actorKind: 'user',
                action: 'apply',
                resource: 'proxy-runtime',
                targetId: null,
                result: 'success',
                metadata: { runtimeStatus: 'applied' },
            })
            return true
        })) ?? false
    )
}

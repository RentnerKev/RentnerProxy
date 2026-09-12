import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { isCertificateJobActive } from '../../../config/certificate-jobs.config'
import { PERMISSIONS, type PermissionKey } from '../../../config/permissions.config'
import { certificates, certificateJobs, proxyHosts } from '../../../db/schema'
import {
    certificateJobIdInputSchema,
    createProxyHostWithCertificateInputSchema,
    requestProxyHostCertificateInputSchema,
    updateProxyHostWithCertificateInputSchema,
    type RequestProxyHostCertificateInput,
} from '../../../features/Admin/ProxyHostManagement/certificate-job-validation'
import type { CertificateJobSummary } from '../../../shared/Types/certificate-jobs.types'
import { appendAuditEventInTransaction } from '../../Audit/audit.service'
import { requirePermissionService } from '../../Auth/Access/authorization.service'
import { getAuthDatabase } from '../../Auth/Core/database.server'
import { requirePermissionInTransaction } from '../../Auth/Access/rbac.service'
import { lockProxyRuntimeSettings } from '../../ProxyRuntime/proxy-runtime-settings'
import {
    createProxyHostInTransaction,
    updateProxyHostInTransaction,
} from './proxy-hosts.mutations.server'
import {
    assertNoActiveHostJob,
    canonicalHostForDigest,
    certificateCoversHostDomains,
    checkIdempotency,
    createPendingCertificateAndJob,
    digestJobRequest,
    findJobByIdempotency,
    normalizeRequest,
    parse,
    permissionsForCreate,
    permissionsForUpdate,
    requireActorPermissions,
    requireTransactionPermissions,
    type CreateJobInput,
    type ParsedRequest,
    type UpdateJobInput,
} from './certificate-jobs.creation'
import {
    certificateJobSummary,
    CertificateJobDomainError,
    readCertificateJobHost,
    validateCertificateJobContext,
} from './certificate-jobs.storage.server'

async function createJobTransaction(
    actorId: string,
    input: CreateJobInput,
    request: ParsedRequest,
    requiredPermissions: readonly PermissionKey[],
    requestDigest: string,
): Promise<CertificateJobSummary> {
    return getAuthDatabase().transaction(async (transaction) => {
        const first = await findJobByIdempotency(transaction, actorId, input.idempotencyKey)
        if (first) return checkIdempotency(first, requestDigest)
        await lockProxyRuntimeSettings(transaction)
        const concurrent = await findJobByIdempotency(transaction, actorId, input.idempotencyKey)
        if (concurrent) return checkIdempotency(concurrent, requestDigest)
        await requireTransactionPermissions(transaction, actorId, requiredPermissions)
        const host = await createProxyHostInTransaction(transaction, actorId, {
            ...input.host,
            enabled: false,
            certificateId: null,
            forceHttps: false,
        })
        const hostState = await readCertificateJobHost(transaction, host.id)
        return createPendingCertificateAndJob(
            transaction,
            actorId,
            input.idempotencyKey,
            host.id,
            hostState.revision,
            request.domains,
            request,
            requestDigest,
            requiredPermissions,
            input.host.enabled,
            input.host.forceHttps ?? false,
        )
    })
}

async function updateJobTransaction(
    actorId: string,
    input: UpdateJobInput,
    request: ParsedRequest,
    requestDigest: string,
): Promise<CertificateJobSummary> {
    return getAuthDatabase().transaction(async (transaction) => {
        const first = await findJobByIdempotency(transaction, actorId, input.idempotencyKey)
        if (first) return checkIdempotency(first, requestDigest)
        await lockProxyRuntimeSettings(transaction)
        const concurrent = await findJobByIdempotency(transaction, actorId, input.idempotencyKey)
        if (concurrent) return checkIdempotency(concurrent, requestDigest)
        await requireTransactionPermissions(transaction, actorId, [
            PERMISSIONS.PROXY_HOSTS_UPDATE,
            PERMISSIONS.CERTIFICATES_ISSUE,
        ])
        const current = await readCertificateJobHost(transaction, input.host.proxyHostId)
        await assertNoActiveHostJob(transaction, current.host.id)
        const retainCertificate = await certificateCoversHostDomains(
            transaction,
            current.host.certificateId,
            request.domains,
        )
        const requiredPermissions = permissionsForUpdate(input, current, retainCertificate)
        await requireTransactionPermissions(transaction, actorId, requiredPermissions)
        const updated = await updateProxyHostInTransaction(transaction, actorId, {
            ...input.host,
            enabled: retainCertificate ? input.host.enabled : false,
            certificateId: retainCertificate ? current.host.certificateId : null,
            forceHttps: retainCertificate
                ? (input.host.forceHttps ?? current.host.forceHttps)
                : false,
        })
        const hostState = await readCertificateJobHost(transaction, updated.id)
        return createPendingCertificateAndJob(
            transaction,
            actorId,
            input.idempotencyKey,
            updated.id,
            hostState.revision,
            request.domains,
            request,
            requestDigest,
            requiredPermissions,
            input.host.enabled,
            input.host.forceHttps ?? current.host.forceHttps,
        )
    })
}

export async function createProxyHostWithCertificateService(
    input: z.input<typeof createProxyHostWithCertificateInputSchema>,
): Promise<CertificateJobSummary> {
    const parsed = parse(createProxyHostWithCertificateInputSchema, input)
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_CREATE)
    const request = normalizeRequest(parsed.host.domains, parsed.request)
    const requiredPermissions = permissionsForCreate(parsed, parsed.host.enabled)
    requireActorPermissions(actor, requiredPermissions)
    return createJobTransaction(
        actor.id,
        parsed,
        request,
        requiredPermissions,
        digestJobRequest(null, canonicalHostForDigest(parsed.host), request),
    )
}

export async function updateProxyHostWithCertificateService(
    input: z.input<typeof updateProxyHostWithCertificateInputSchema>,
): Promise<CertificateJobSummary> {
    const parsed = parse(updateProxyHostWithCertificateInputSchema, input)
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    const request = normalizeRequest(parsed.host.domains, parsed.request)
    requireActorPermissions(actor, [PERMISSIONS.CERTIFICATES_ISSUE])
    return updateJobTransaction(
        actor.id,
        parsed,
        request,
        digestJobRequest(
            parsed.host.proxyHostId.toLowerCase(),
            canonicalHostForDigest(parsed.host),
            request,
        ),
    )
}

async function requestJobTransaction(
    actorId: string,
    input: RequestProxyHostCertificateInput,
): Promise<CertificateJobSummary> {
    const proxyHostId = input.proxyHostId.toLowerCase()
    return getAuthDatabase().transaction(async (transaction) => {
        const first = await findJobByIdempotency(transaction, actorId, input.idempotencyKey)
        if (first) {
            const request = normalizeRequest(first.domains, input.request)
            return checkIdempotency(first, digestJobRequest(proxyHostId, null, request))
        }
        await lockProxyRuntimeSettings(transaction)
        const concurrent = await findJobByIdempotency(transaction, actorId, input.idempotencyKey)
        if (concurrent) {
            const request = normalizeRequest(concurrent.domains, input.request)
            return checkIdempotency(concurrent, digestJobRequest(proxyHostId, null, request))
        }
        await requireTransactionPermissions(transaction, actorId, [
            PERMISSIONS.PROXY_HOSTS_UPDATE,
            PERMISSIONS.CERTIFICATES_ISSUE,
        ])
        const hostState = await readCertificateJobHost(transaction, proxyHostId)
        const expectedUpdatedAt = Date.parse(input.expectedUpdatedAt)
        if (
            !Number.isFinite(expectedUpdatedAt) ||
            expectedUpdatedAt !== hostState.host.updatedAt.getTime()
        )
            throw new CertificateJobDomainError('host_changed')
        await assertNoActiveHostJob(transaction, hostState.host.id)
        const request = normalizeRequest(hostState.domains, input.request)
        const retainCertificate = await certificateCoversHostDomains(
            transaction,
            hostState.host.certificateId,
            hostState.domains,
        )
        const requiredPermissions: PermissionKey[] = [
            PERMISSIONS.PROXY_HOSTS_UPDATE,
            PERMISSIONS.CERTIFICATES_ISSUE,
        ]
        if (!retainCertificate && hostState.host.enabled) {
            requiredPermissions.push(
                PERMISSIONS.PROXY_HOSTS_DISABLE,
                PERMISSIONS.PROXY_HOSTS_ENABLE,
            )
        }
        const uniquePermissions = [...new Set(requiredPermissions)]
        await requireTransactionPermissions(transaction, actorId, uniquePermissions)
        if (!retainCertificate) {
            await transaction
                .update(proxyHosts)
                .set({
                    enabled: false,
                    certificateId: null,
                    forceHttps: false,
                    updatedAt: new Date(),
                })
                .where(eq(proxyHosts.id, hostState.host.id))
            await appendAuditEventInTransaction(transaction, {
                actorUserId: actorId,
                actorKind: 'user',
                action: 'update',
                resource: 'proxy-host',
                targetId: hostState.host.id,
                result: 'success',
                metadata: { changedFields: ['certificate', 'status', 'tls'] },
            })
        }
        const current = await readCertificateJobHost(transaction, hostState.host.id)
        const requestDigest = digestJobRequest(proxyHostId, null, request)
        return createPendingCertificateAndJob(
            transaction,
            actorId,
            input.idempotencyKey,
            proxyHostId,
            current.revision,
            request.domains,
            request,
            requestDigest,
            uniquePermissions,
            hostState.host.enabled,
            hostState.host.forceHttps,
        )
    })
}

export async function requestProxyHostCertificateService(
    input: z.input<typeof requestProxyHostCertificateInputSchema>,
): Promise<CertificateJobSummary> {
    const parsed = parse(requestProxyHostCertificateInputSchema, input)
    const actor = await requirePermissionService(PERMISSIONS.PROXY_HOSTS_UPDATE)
    requireActorPermissions(actor, [PERMISSIONS.CERTIFICATES_ISSUE])
    return requestJobTransaction(actor.id, parsed)
}

export async function getCertificateJobService(jobId: string): Promise<CertificateJobSummary> {
    const id = parse(certificateJobIdInputSchema, { jobId }).jobId.toLowerCase()
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
    const [job] = await getAuthDatabase()
        .select()
        .from(certificateJobs)
        .where(eq(certificateJobs.id, id))
        .limit(1)
    if (!job) throw new CertificateJobDomainError('job_not_found')
    return certificateJobSummary(job)
}

export async function retryCertificateJobService(jobId: string): Promise<CertificateJobSummary> {
    const id = parse(certificateJobIdInputSchema, { jobId }).jobId.toLowerCase()
    const actor = await requirePermissionService(PERMISSIONS.CERTIFICATES_ISSUE)
    return getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        const rows = await transaction
            .select()
            .from(certificateJobs)
            .where(eq(certificateJobs.id, id))
            .limit(1)
            .for('update')
        const job = rows.at(0)
        if (!job) throw new CertificateJobDomainError('job_not_found')
        const leaseActive = job.leaseExpiresAt !== null && job.leaseExpiresAt.getTime() > Date.now()
        if (
            job.stage === 'applied' ||
            (isCertificateJobActive(job.stage) && (!job.lastErrorCode || leaseActive))
        ) {
            throw new CertificateJobDomainError('operation_in_progress')
        }
        await requirePermissionInTransaction(transaction, actor.id, PERMISSIONS.CERTIFICATES_ISSUE)
        await requireTransactionPermissions(transaction, actor.id, job.requiredPermissions)
        await validateCertificateJobContext(transaction, job)
        if (!job.certificateId) throw new CertificateJobDomainError('certificate_deleted')
        const certificate = await transaction
            .select({ id: certificates.id })
            .from(certificates)
            .where(eq(certificates.id, job.certificateId))
            .limit(1)
            .for('update')
        if (!certificate.at(0)) throw new CertificateJobDomainError('certificate_deleted')
        const [updated] = await transaction
            .update(certificateJobs)
            .set({
                stage: job.assignedRevision ? 'applying' : 'preparing',
                lastErrorCode: null,
                retryRequested: true,
                nextAttemptAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(certificateJobs.id, job.id))
            .returning()
        if (!updated) throw new CertificateJobDomainError('certificate_store_unavailable')
        return certificateJobSummary(updated)
    })
}

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { isCertificateJobActive } from '../../../config/certificate-jobs.config'
import { PERMISSIONS, type PermissionKey } from '../../../config/permissions.config'
import { certificates, certificateDomains, certificateJobs } from '../../../db/schema'
import { requestCertificateInputSchema } from '../../../features/Admin/CertificateManagement/validation'
import {
    createProxyHostWithCertificateInputSchema,
    updateProxyHostWithCertificateInputSchema,
    type HostCertificateRequest,
} from '../../../features/Admin/ProxyHostManagement/certificate-job-validation'
import { certificateCoversDomains } from '../../../features/Admin/CertificateManagement/Helpers/certificateValidation'
import type { CertificateJobSummary } from '../../../shared/Types/certificate-jobs.types'
import { AuthDomainError } from '../../Auth/Core/errors.server'
import { encryptSecret } from '../../Auth/Core/encryption.server'
import { requirePermissionInTransaction } from '../../Auth/Access/rbac.service'
import { getControllerCertificate } from '../../Foundation/certificates.server'
import { CertificateDomainError } from '../CertificateManagement/certificates.errors'
import { appendAuditEventInTransaction } from '../../Audit/audit.service'
import type { AuthTransaction } from '../../Auth/Core/database.server'
import {
    certificateJobDigest,
    certificateJobSummary,
    CertificateJobDomainError,
    readCertificateJobHost,
    type CertificateJobRow,
} from './certificate-jobs.storage.server'

export type CreateJobInput = z.output<typeof createProxyHostWithCertificateInputSchema>
export type UpdateJobInput = z.output<typeof updateProxyHostWithCertificateInputSchema>
export type ParsedRequest = z.output<typeof requestCertificateInputSchema>

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
    const result = schema.safeParse(input)
    if (!result.success) throw new CertificateJobDomainError('invalid_input')
    return result.data
}

export function digestJobRequest(
    proxyHostId: string | null,
    host: unknown,
    request: ParsedRequest,
): string {
    return certificateJobDigest({ proxyHostId, host, request })
}

export function canonicalHostForDigest(host: unknown): unknown {
    if (host === null || typeof host !== 'object' || Array.isArray(host)) return host
    const value = { ...(host as Record<string, unknown>) }
    if (Array.isArray(value.domains)) value.domains = [...value.domains].toSorted()
    for (const key of ['proxyHostId', 'certificateId', 'trustedCaId', 'accessPolicyId']) {
        if (typeof value[key] === 'string') value[key] = value[key].toLowerCase()
    }
    return value
}

export function normalizeRequest(
    hostDomains: readonly string[],
    request: HostCertificateRequest,
): ParsedRequest {
    return parse(requestCertificateInputSchema, {
        ...request,
        domains: [...hostDomains].toSorted(),
    })
}

export function requireActorPermissions(
    actor: { readonly permissions: readonly PermissionKey[] },
    permissions: readonly PermissionKey[],
): void {
    for (const permission of permissions) {
        if (!actor.permissions.includes(permission)) {
            throw new AuthDomainError('permission_denied', 'Permission is required.')
        }
    }
}

export async function requireTransactionPermissions(
    transaction: AuthTransaction,
    actorId: string,
    permissions: readonly PermissionKey[],
): Promise<void> {
    await permissions.reduce(async (previous, permission) => {
        await previous
        await requirePermissionInTransaction(transaction, actorId, permission)
    }, Promise.resolve())
}

export function permissionsForCreate(
    input: CreateJobInput,
    desiredEnabled: boolean,
): PermissionKey[] {
    const permissions: PermissionKey[] = [
        PERMISSIONS.PROXY_HOSTS_CREATE,
        PERMISSIONS.CERTIFICATES_ISSUE,
    ]
    if (desiredEnabled) permissions.push(PERMISSIONS.PROXY_HOSTS_ENABLE)
    if (input.host.accessPolicyId) permissions.push(PERMISSIONS.ACCESS_POLICIES_ASSIGN)
    return [...new Set(permissions)]
}

export function permissionsForUpdate(
    input: UpdateJobInput,
    current: Awaited<ReturnType<typeof readCertificateJobHost>>,
    retainCertificate: boolean,
): PermissionKey[] {
    const permissions: PermissionKey[] = [
        PERMISSIONS.PROXY_HOSTS_UPDATE,
        PERMISSIONS.CERTIFICATES_ISSUE,
    ]
    const desiredEnabled = input.host.enabled
    const currentEnabled = current.host.enabled
    if (desiredEnabled !== currentEnabled) {
        permissions.push(
            desiredEnabled ? PERMISSIONS.PROXY_HOSTS_ENABLE : PERMISSIONS.PROXY_HOSTS_DISABLE,
        )
    }
    if (!retainCertificate && currentEnabled) {
        permissions.push(PERMISSIONS.PROXY_HOSTS_DISABLE)
    }
    if (!retainCertificate && desiredEnabled) {
        permissions.push(PERMISSIONS.PROXY_HOSTS_ENABLE)
    }
    const requestedPolicy =
        input.host.accessPolicyId === undefined
            ? current.host.accessPolicyId
            : (input.host.accessPolicyId?.toLowerCase() ?? null)
    if (requestedPolicy !== current.host.accessPolicyId) {
        permissions.push(PERMISSIONS.ACCESS_POLICIES_ASSIGN)
    }
    return [...new Set(permissions)]
}

export async function certificateCoversHostDomains(
    transaction: AuthTransaction,
    certificateId: string | null,
    domains: readonly string[],
): Promise<boolean> {
    if (!certificateId) return false
    const [certificate] = await transaction
        .select({ id: certificates.id })
        .from(certificates)
        .where(eq(certificates.id, certificateId))
        .limit(1)
    if (!certificate) return false
    let metadata
    try {
        metadata = await getControllerCertificate(certificateId)
    } catch (error) {
        if (error instanceof CertificateDomainError && error.code === 'certificate_not_found') {
            return false
        }
        throw new CertificateJobDomainError('controller_unavailable')
    }
    if (
        metadata.status !== 'valid' ||
        !metadata.issuedAt ||
        !metadata.expiresAt ||
        Date.parse(metadata.issuedAt) > Date.now() ||
        Date.parse(metadata.expiresAt) <= Date.now()
    )
        return false
    return certificateCoversDomains(metadata.domains, domains)
}

export async function findJobByIdempotency(
    transaction: AuthTransaction,
    actorId: string,
    idempotencyKey: string,
): Promise<CertificateJobRow | null> {
    const rows = await transaction
        .select()
        .from(certificateJobs)
        .where(
            and(
                eq(certificateJobs.actorUserId, actorId),
                eq(certificateJobs.idempotencyKey, idempotencyKey),
            ),
        )
        .limit(1)
        .for('update')
    return rows.at(0) ?? null
}

export async function assertNoActiveHostJob(
    transaction: AuthTransaction,
    proxyHostId: string,
): Promise<void> {
    const rows = await transaction
        .select({ stage: certificateJobs.stage })
        .from(certificateJobs)
        .where(eq(certificateJobs.proxyHostId, proxyHostId))
    if (rows.some((row) => isCertificateJobActive(row.stage))) {
        throw new CertificateJobDomainError('operation_in_progress')
    }
}

export function checkIdempotency(
    job: CertificateJobRow,
    requestDigest: string,
): CertificateJobSummary {
    if (job.requestDigest !== requestDigest) {
        throw new CertificateJobDomainError('idempotency_conflict')
    }
    return certificateJobSummary(job)
}

export async function createPendingCertificateAndJob(
    transaction: AuthTransaction,
    actorId: string,
    idempotencyKey: string,
    proxyHostId: string,
    hostRevision: string,
    domains: readonly string[],
    request: ParsedRequest,
    requestDigest: string,
    requiredPermissions: readonly PermissionKey[],
    desiredEnabled: boolean,
    desiredForceHttps: boolean,
): Promise<CertificateJobSummary> {
    const certificateRows = await transaction
        .insert(certificates)
        .values({
            name: request.name,
            source: 'acme',
            environment: request.environment,
            status: 'pending',
            operation: 'issuing',
            challengeType: request.challengeType,
        })
        .returning({ id: certificates.id })
    const certificate = certificateRows.at(0)
    if (!certificate) throw new CertificateJobDomainError('certificate_store_unavailable')
    await transaction
        .insert(certificateDomains)
        .values(domains.map((domain) => ({ certificateId: certificate.id, domain })))
    await appendAuditEventInTransaction(transaction, {
        actorUserId: actorId,
        actorKind: 'user',
        action: 'create',
        resource: 'certificate',
        targetId: certificate.id,
        result: 'success',
    })
    const jobRows = await transaction
        .insert(certificateJobs)
        .values({
            actorUserId: actorId,
            proxyHostId,
            certificateId: certificate.id,
            idempotencyKey,
            requestDigest,
            domains: [...domains],
            requiredPermissions: [...requiredPermissions],
            hostRevision,
            desiredEnabled,
            desiredForceHttps,
            stage: 'preparing',
            nextAttemptAt: new Date(),
        })
        .returning()
    const job = jobRows.at(0)
    if (!job) throw new CertificateJobDomainError('certificate_store_unavailable')
    const encrypted = await encryptSecret(
        JSON.stringify(request),
        `certificate-binding-job:${job.id}`,
    )
    const [encryptedJob] = await transaction
        .update(certificateJobs)
        .set({
            requestCiphertext: encrypted.ciphertext,
            requestIv: encrypted.iv,
            updatedAt: new Date(),
        })
        .where(eq(certificateJobs.id, job.id))
        .returning()
    if (!encryptedJob) throw new CertificateJobDomainError('certificate_store_unavailable')
    return certificateJobSummary(encryptedJob)
}

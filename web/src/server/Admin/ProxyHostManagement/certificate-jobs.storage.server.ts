import '@tanstack/react-start/server-only'

import { createHash } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { CertificateJobErrorCode } from '../../../config/certificate-jobs.config'
import { PERMISSIONS } from '../../../config/permissions.config'
import { certificateJobs, hostDomains, proxyHosts } from '../../../db/schema'
import type { CertificateJobSummary } from '../../../shared/Types/certificate-jobs.types'
import type { AuthTransaction } from '../../Auth/Core/database.server'
import { requirePermissionInTransaction } from '../../Auth/Access/rbac.service'
import { AuthDomainError } from '../../Auth/Core/errors.server'
import { readProxyHostHttpSettings } from '../../ProxyRuntime/proxy-runtime-settings'

export type CertificateJobRow = typeof certificateJobs.$inferSelect

export class CertificateJobDomainError extends Error {
    readonly code: CertificateJobErrorCode
    constructor(code: CertificateJobErrorCode) {
        super(code)
        this.name = 'CertificateJobDomainError'
        this.code = code
    }
}

function canonicalValue(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(canonicalValue)
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, entry]) => [key, canonicalValue(entry)]),
        )
    }
    return value
}

export function certificateJobDigest(value: unknown): string {
    return createHash('sha256')
        .update(JSON.stringify(canonicalValue(value)))
        .digest('hex')
}

export function certificateJobSummary(job: CertificateJobRow): CertificateJobSummary {
    return {
        id: job.id,
        proxyHostId: job.proxyHostId,
        certificateId: job.certificateId,
        domains: job.domains,
        stage: job.stage,
        controllerStage: job.controllerStage,
        lastErrorCode: job.lastErrorCode,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
    }
}

export async function readCertificateJobHost(transaction: AuthTransaction, id: string) {
    const [host] = await transaction
        .select()
        .from(proxyHosts)
        .where(eq(proxyHosts.id, id))
        .for('update')
    if (!host) throw new CertificateJobDomainError('host_deleted')
    const domainRows = await transaction
        .select({ domain: hostDomains.domain })
        .from(hostDomains)
        .where(eq(hostDomains.proxyHostId, id))
        .orderBy(asc(hostDomains.domain))
    const domains = domainRows.map((row) => row.domain)
    const httpSettings = await readProxyHostHttpSettings(transaction, id)
    return { host, domains, revision: certificateJobDigest({ host, domains, httpSettings }) }
}

const allowedPermissions = new Set<string>([
    PERMISSIONS.PROXY_HOSTS_CREATE,
    PERMISSIONS.PROXY_HOSTS_UPDATE,
    PERMISSIONS.PROXY_HOSTS_ENABLE,
    PERMISSIONS.PROXY_HOSTS_DISABLE,
    PERMISSIONS.ACCESS_POLICIES_ASSIGN,
    PERMISSIONS.CERTIFICATES_ISSUE,
])

export async function validateCertificateJobContext(
    transaction: AuthTransaction,
    job: CertificateJobRow,
) {
    if (!job.proxyHostId) throw new CertificateJobDomainError('host_deleted')
    if (!job.certificateId) throw new CertificateJobDomainError('certificate_deleted')
    if (!job.actorUserId || !job.requiredPermissions.length)
        throw new CertificateJobDomainError('permission_revoked')
    try {
        const first = job.requiredPermissions[0]
        if (
            !first ||
            !job.requiredPermissions.every((permission) => allowedPermissions.has(permission))
        )
            throw new CertificateJobDomainError('permission_revoked')
        const actor = await requirePermissionInTransaction(transaction, job.actorUserId, first)
        if (!job.requiredPermissions.every((permission) => actor.permissions.includes(permission)))
            throw new CertificateJobDomainError('permission_revoked')
    } catch (error) {
        if (error instanceof AuthDomainError || error instanceof CertificateJobDomainError)
            throw new CertificateJobDomainError('permission_revoked')
        throw error
    }
    const current = await readCertificateJobHost(transaction, job.proxyHostId)
    if (
        current.revision !== (job.assignedRevision ?? job.hostRevision) ||
        certificateJobDigest(current.domains) !== certificateJobDigest(job.domains)
    ) {
        throw new CertificateJobDomainError('host_changed')
    }
    return current
}

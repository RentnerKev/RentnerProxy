import '@tanstack/react-start/server-only'

import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { certificateJobs } from '../../../db/schema'
import { getAuthDatabase, type AuthTransaction } from '../../Auth/Core/database.server'
import { lockProxyRuntimeSettings } from '../../ProxyRuntime/proxy-runtime-settings'
import type { CertificateJobRow } from './certificate-jobs.storage.server'

export async function claimCertificateJob(): Promise<CertificateJobRow | null> {
    return getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        const now = new Date()
        const [job] = await transaction
            .select()
            .from(certificateJobs)
            .where(
                and(
                    inArray(certificateJobs.stage, ['preparing', 'issuing', 'applying']),
                    lte(certificateJobs.nextAttemptAt, now),
                    or(
                        isNull(certificateJobs.leaseExpiresAt),
                        lte(certificateJobs.leaseExpiresAt, now),
                    ),
                ),
            )
            .orderBy(asc(certificateJobs.nextAttemptAt), asc(certificateJobs.id))
            .limit(1)
            .for('update', { skipLocked: true })
        if (!job) return null
        const [claimed] = await transaction
            .update(certificateJobs)
            .set({
                leaseToken: randomUUID(),
                leaseExpiresAt: new Date(now.getTime() + 90_000),
                attemptCount: sql`least(${certificateJobs.attemptCount} + 1, 2147483647)`,
            })
            .where(eq(certificateJobs.id, job.id))
            .returning()
        return claimed ?? null
    })
}

export async function withCertificateJobClaim<T>(
    job: CertificateJobRow,
    action: (transaction: AuthTransaction, current: CertificateJobRow) => Promise<T>,
): Promise<T | undefined> {
    const token = job.leaseToken
    if (!token) return undefined
    return getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        const [current] = await transaction
            .select()
            .from(certificateJobs)
            .where(and(eq(certificateJobs.id, job.id), eq(certificateJobs.leaseToken, token)))
            .for('update')
        if (!current || !current.leaseExpiresAt || current.leaseExpiresAt.getTime() <= Date.now())
            return undefined
        return action(transaction, current)
    })
}

export async function releaseCertificateJob(
    job: CertificateJobRow,
    changes: Partial<typeof certificateJobs.$inferInsert> = {},
): Promise<void> {
    await withCertificateJobClaim(job, async (transaction, current) => {
        await transaction
            .update(certificateJobs)
            .set({
                ...changes,
                leaseToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: new Date(Date.now() + 5_000),
                updatedAt: new Date(),
            })
            .where(eq(certificateJobs.id, current.id))
    })
}

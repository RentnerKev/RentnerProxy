import '@tanstack/react-start/server-only'

import { asc, count, eq } from 'drizzle-orm'
import type { z } from 'zod'

import { PERMISSIONS, type PermissionKey } from '../../../config/permissions.config'
import { proxyHosts, trustedCas } from '../../../db/schema'
import {
    createTrustedCaInputSchema,
    replaceTrustedCaInputSchema,
    trustedCaIdInputSchema,
    type CreateTrustedCaInput,
    type ReplaceTrustedCaInput,
} from '../../../features/Admin/TrustedCaManagement/validation'
import type { TrustedCaSummary } from '../../../shared/Types/trusted-cas.types'
import {
    requirePermissionService,
    requireUserService,
} from '../../Auth/Access/authorization.service'
import { requirePermissionInTransaction } from '../../Auth/Access/rbac.service'
import { getAuthDatabase, type AuthTransaction } from '../../Auth/Core/database.server'
import { validateControllerTrustedCa } from '../../Foundation/trusted-cas.server'
import { reconcileProxyConfigurationService } from '../../ProxyRuntime/proxy-runtime.service'
import { lockProxyRuntimeSettings } from '../../ProxyRuntime/proxy-runtime-settings'
import { TrustedCaDomainError } from './trusted-cas.errors'

export type TrustedCaMutationResult = {
    readonly trustedCaId: string
    readonly runtimeStatus: 'applied' | 'pending'
}

type TrustedCaRow = typeof trustedCas.$inferSelect

function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw new TrustedCaDomainError('invalid_input')
    return parsed.data
}

function parseId(trustedCaId: string): string {
    return parseInput(trustedCaIdInputSchema, { trustedCaId }).trustedCaId.toLowerCase()
}

function mapTrustedCaDatabaseError(error: unknown): TrustedCaDomainError | null {
    const seen = new Set<unknown>()
    let current: unknown = error
    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current)
        const databaseError = current as Record<string, unknown>
        const uniqueViolation = [
            databaseError.code,
            databaseError.errno,
            databaseError.sqlState,
        ].includes('23505')
        const constraint =
            databaseError.constraint ??
            databaseError.constraintName ??
            databaseError.constraint_name
        if (uniqueViolation && constraint === 'trusted_cas_fingerprint_sha256_unique')
            return new TrustedCaDomainError('trusted_ca_duplicate')
        current = databaseError.cause
    }
    return null
}

async function getTrustedCaForUpdate(
    transaction: AuthTransaction,
    trustedCaId: string,
): Promise<TrustedCaRow> {
    const [trustedCa] = await transaction
        .select()
        .from(trustedCas)
        .where(eq(trustedCas.id, trustedCaId))
        .limit(1)
        .for('update')
    if (!trustedCa) throw new TrustedCaDomainError('trusted_ca_not_found')
    return trustedCa
}

async function readTrustedCaSummaries(): Promise<TrustedCaSummary[]> {
    return getAuthDatabase().transaction(
        async (transaction) => {
            const rows = await transaction
                .select()
                .from(trustedCas)
                .orderBy(asc(trustedCas.createdAt), asc(trustedCas.id))
            const assignments = await transaction
                .select({ trustedCaId: proxyHosts.trustedCaId, count: count() })
                .from(proxyHosts)
                .where(eq(proxyHosts.verifyUpstreamTls, true))
                .groupBy(proxyHosts.trustedCaId)
            const assignmentCounts = new Map(
                assignments.flatMap((entry) =>
                    entry.trustedCaId === null ? [] : [[entry.trustedCaId, entry.count] as const],
                ),
            )
            return rows.map((row) => ({
                id: row.id,
                name: row.name,
                subject: row.subject,
                issuer: row.issuer,
                fingerprintSha256: row.fingerprintSha256,
                notBefore: row.notBefore,
                notAfter: row.notAfter,
                assignedHostCount: assignmentCounts.get(row.id) ?? 0,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
            }))
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
}

export async function getTrustedCasService(): Promise<TrustedCaSummary[]> {
    await requirePermissionService(PERMISSIONS.TRUSTED_CAS_VIEW)
    return readTrustedCaSummaries()
}

export async function getAssignableTrustedCasService(): Promise<TrustedCaSummary[]> {
    const actor = await requireUserService()
    if (
        !actor.permissions.includes(PERMISSIONS.PROXY_HOSTS_CREATE) &&
        !actor.permissions.includes(PERMISSIONS.PROXY_HOSTS_UPDATE)
    )
        throw new TrustedCaDomainError('trusted_ca_not_found')
    return readTrustedCaSummaries()
}

async function persistTrustedCa(
    actorId: string,
    permission: PermissionKey,
    input: { readonly name: string; readonly pem: string },
    existingId?: string,
): Promise<TrustedCaMutationResult> {
    const metadata = await validateControllerTrustedCa(input.pem)
    let trustedCaId: string
    try {
        trustedCaId = await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(transaction, actorId, permission)
            if (existingId) {
                await getTrustedCaForUpdate(transaction, existingId)
                await transaction
                    .update(trustedCas)
                    .set({
                        name: input.name,
                        pem: metadata.pem,
                        fingerprintSha256: metadata.fingerprintSha256,
                        subject: metadata.subject,
                        issuer: metadata.issuer,
                        notBefore: new Date(metadata.notBefore),
                        notAfter: new Date(metadata.notAfter),
                        updatedAt: new Date(),
                    })
                    .where(eq(trustedCas.id, existingId))
                return existingId
            }
            const [created] = await transaction
                .insert(trustedCas)
                .values({
                    name: input.name,
                    pem: metadata.pem,
                    fingerprintSha256: metadata.fingerprintSha256,
                    subject: metadata.subject,
                    issuer: metadata.issuer,
                    notBefore: new Date(metadata.notBefore),
                    notAfter: new Date(metadata.notAfter),
                })
                .returning({ id: trustedCas.id })
            if (!created) throw new TrustedCaDomainError('controller_unavailable')
            return created.id
        })
    } catch (error) {
        const databaseError = mapTrustedCaDatabaseError(error)
        if (databaseError) throw databaseError
        throw error
    }
    return { trustedCaId, runtimeStatus: await reconcileProxyConfigurationService() }
}

export async function createTrustedCaService(
    input: CreateTrustedCaInput,
): Promise<TrustedCaMutationResult> {
    const actor = await requirePermissionService(PERMISSIONS.TRUSTED_CAS_CREATE)
    const parsed = parseInput(createTrustedCaInputSchema, input)
    return persistTrustedCa(actor.id, PERMISSIONS.TRUSTED_CAS_CREATE, parsed)
}

export async function replaceTrustedCaService(
    input: ReplaceTrustedCaInput,
): Promise<TrustedCaMutationResult> {
    const actor = await requirePermissionService(PERMISSIONS.TRUSTED_CAS_UPDATE)
    const parsed = parseInput(replaceTrustedCaInputSchema, input)
    return persistTrustedCa(
        actor.id,
        PERMISSIONS.TRUSTED_CAS_UPDATE,
        parsed,
        parsed.trustedCaId.toLowerCase(),
    )
}

export async function deleteTrustedCaService(
    trustedCaId: string,
): Promise<TrustedCaMutationResult> {
    const actor = await requirePermissionService(PERMISSIONS.TRUSTED_CAS_DELETE)
    const id = parseId(trustedCaId)
    await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(transaction, actor.id, PERMISSIONS.TRUSTED_CAS_DELETE)
        await getTrustedCaForUpdate(transaction, id)
        const [assigned] = await transaction
            .select({ id: proxyHosts.id })
            .from(proxyHosts)
            .where(eq(proxyHosts.trustedCaId, id))
            .limit(1)
        if (assigned) throw new TrustedCaDomainError('trusted_ca_in_use')
        await transaction.delete(trustedCas).where(eq(trustedCas.id, id))
    })
    return { trustedCaId: id, runtimeStatus: await reconcileProxyConfigurationService() }
}

export async function validateTrustedCaAssignmentInTransaction(
    transaction: AuthTransaction,
    trustedCaId: string | null,
): Promise<void> {
    if (trustedCaId === null) return
    await getTrustedCaForUpdate(transaction, trustedCaId)
}

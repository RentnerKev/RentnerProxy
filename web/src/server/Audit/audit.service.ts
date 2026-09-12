import '@tanstack/react-start/server-only'

import { lt, sql } from 'drizzle-orm'

import { auditEvents } from '../../db/schema'
import type { AuditEventInput, AuditMetadata } from '../../shared/Types/audit-events.types'
import { auditEventInputSchema } from '../../features/Admin/AuditLogs/validation'
import { getAuthDatabase, type AuthTransaction } from '../Auth/Core/database.server'
import { AuthDomainError } from '../Auth/Core/errors.server'

export const AUDIT_RETENTION_DAYS = 90
export const AUDIT_MAX_ROWS = 100_000
export const AUDIT_RETENTION_LOCK_ID = 7_421_908
const AUDIT_METADATA_MAX_BYTES = 4_096

function jsonByteLength(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function parseEventInput(input: AuditEventInput): AuditEventInput {
    let parsed: ReturnType<typeof auditEventInputSchema.parse>
    try {
        parsed = auditEventInputSchema.parse(input)
    } catch {
        throw new AuthDomainError('invalid_input', 'Audit event is invalid.')
    }
    const metadata = parsed.metadata ?? {}
    if (jsonByteLength(metadata) > AUDIT_METADATA_MAX_BYTES) {
        throw new AuthDomainError('invalid_input', 'Audit metadata is too large.')
    }
    return {
        ...parsed,
        metadata: Object.fromEntries(
            Object.entries(metadata).filter(([, value]) => value !== undefined),
        ) as AuditMetadata,
    }
}

export async function appendAuditEventInTransaction(
    transaction: AuthTransaction,
    input: AuditEventInput,
): Promise<void> {
    const parsed = parseEventInput(input)

    await transaction.execute(sql`select pg_advisory_xact_lock(${AUDIT_RETENTION_LOCK_ID})`)
    await transaction.insert(auditEvents).values({
        actorUserId: parsed.actorUserId,
        actorKind: parsed.actorKind,
        action: parsed.action,
        resource: parsed.resource,
        targetId: parsed.targetId,
        result: parsed.result,
        metadata: parsed.metadata ?? {},
    })
    await pruneAuditEventsInTransaction(transaction)
}

export async function appendAuditEventsInTransaction(
    transaction: AuthTransaction,
    inputs: readonly AuditEventInput[],
): Promise<void> {
    if (inputs.length === 0) return
    if (inputs.length > 500) throw new AuthDomainError('invalid_input', 'Audit batch is too large.')
    const events = inputs.map(parseEventInput)
    await transaction.execute(sql`select pg_advisory_xact_lock(${AUDIT_RETENTION_LOCK_ID})`)
    await transaction.insert(auditEvents).values(
        events.map((event) => ({
            actorUserId: event.actorUserId,
            actorKind: event.actorKind,
            action: event.action,
            resource: event.resource,
            targetId: event.targetId,
            result: event.result,
            metadata: event.metadata ?? {},
        })),
    )
    await pruneAuditEventsInTransaction(transaction)
}

export async function recordAuditEventBestEffort(input: AuditEventInput): Promise<void> {
    try {
        await getAuthDatabase().transaction(async (transaction) => {
            await appendAuditEventInTransaction(transaction, input)
        })
    } catch {}
}

export async function pruneAuditEventsInTransaction(transaction: AuthTransaction): Promise<void> {
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1_000)
    await transaction.delete(auditEvents).where(lt(auditEvents.createdAt, cutoff))

    await transaction.execute(sql`
        delete from "rentnerproxy"."audit_events"
        where "id" in (
            select "id" from "rentnerproxy"."audit_events"
            order by "created_at" desc, "id" desc
            offset ${AUDIT_MAX_ROWS}
        )
    `)
}

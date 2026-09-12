import '@tanstack/react-start/server-only'

import { and, desc, eq, gte, lte, lt, or, sql } from 'drizzle-orm'

import { PERMISSIONS } from '../../config/permissions.config'
import { auditEvents, users } from '../../db/schema'
import type {
    AuditEventDto,
    AuditEventsQuery,
    AuditEventsResult,
    AuditMetadata,
} from '../../shared/Types/audit-events.types'
import {
    auditEventsQuerySchema,
    auditMetadataSchema,
    encodeAuditCursor,
    parseAuditCursor,
} from '../../features/Admin/AuditLogs/validation'
import { requirePermissionService } from '../Auth/Access/authorization.service'
import { getAuthDatabase } from '../Auth/Core/database.server'
import { AuthDomainError } from '../Auth/Core/errors.server'
import { AUDIT_RETENTION_LOCK_ID, pruneAuditEventsInTransaction } from './audit.service'

const AUDIT_METADATA_MAX_BYTES = 4_096

function jsonByteLength(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function parseStoredMetadata(value: unknown): AuditMetadata {
    const result = auditMetadataSchema.safeParse(value)
    if (!result.success || jsonByteLength(result.data) > AUDIT_METADATA_MAX_BYTES) {
        throw new AuthDomainError('service_unavailable', 'Stored audit metadata is invalid.')
    }
    return result.data as AuditMetadata
}

function queryConditions(query: ReturnType<typeof auditEventsQuerySchema.parse>) {
    const conditions = []
    if (query.actorUserId) conditions.push(eq(auditEvents.actorUserId, query.actorUserId))
    if (query.action) conditions.push(eq(auditEvents.action, query.action))
    if (query.resource) conditions.push(eq(auditEvents.resource, query.resource))
    if (query.result) conditions.push(eq(auditEvents.result, query.result))
    if (query.from) conditions.push(gte(auditEvents.createdAt, new Date(query.from)))
    if (query.to) conditions.push(lte(auditEvents.createdAt, new Date(query.to)))
    if (query.cursor) {
        let cursor: ReturnType<typeof parseAuditCursor>
        try {
            cursor = parseAuditCursor(query.cursor)
        } catch {
            throw new AuthDomainError('invalid_input', 'Audit cursor is invalid.')
        }
        const timestamp = new Date(cursor.timestamp)
        conditions.push(
            or(
                lt(auditEvents.createdAt, timestamp),
                and(eq(auditEvents.createdAt, timestamp), lt(auditEvents.id, cursor.id)),
            ),
        )
    }
    return conditions
}

export async function listAuditEventsService(input: AuditEventsQuery): Promise<AuditEventsResult> {
    await requirePermissionService(PERMISSIONS.AUDIT_LOGS_VIEW)
    const query = auditEventsQuerySchema.parse(input)
    await getAuthDatabase().transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(${AUDIT_RETENTION_LOCK_ID})`)
        await pruneAuditEventsInTransaction(transaction)
    })
    return getAuthDatabase().transaction(
        async (transaction) => {
            const rows = await transaction
                .select({
                    id: auditEvents.id,
                    createdAt: auditEvents.createdAt,
                    actorUserId: auditEvents.actorUserId,
                    actorKind: auditEvents.actorKind,
                    action: auditEvents.action,
                    resource: auditEvents.resource,
                    targetId: auditEvents.targetId,
                    result: auditEvents.result,
                    metadata: auditEvents.metadata,
                    actorDisplayName: users.displayName,
                })
                .from(auditEvents)
                .leftJoin(users, eq(users.id, auditEvents.actorUserId))
                .where(and(...queryConditions(query)))
                .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
                .limit(query.limit + 1)
            const page = rows.slice(0, query.limit)
            const hasMore = rows.length > query.limit
            const events: AuditEventDto[] = page.map((row) => ({
                id: row.id,
                timestamp: row.createdAt.toISOString(),
                actorUserId: row.actorUserId,
                actorKind: row.actorKind,
                action: row.action,
                resource: row.resource,
                targetId: row.targetId,
                result: row.result,
                actorDisplayName: row.actorDisplayName,
                metadata: parseStoredMetadata(row.metadata),
            }))
            const last = page.at(-1)
            return {
                events,
                limit: query.limit,
                nextCursor: hasMore && last ? encodeAuditCursor(last.createdAt, last.id) : null,
                hasMore,
            }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
}

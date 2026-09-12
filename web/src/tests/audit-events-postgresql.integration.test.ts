import { afterEach, describe, expect, test } from 'bun:test'

const integrationEnabled =
    process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && Boolean(process.env.DATABASE_URL)
const integrationTest = integrationEnabled ? test : test.skip

type DatabaseTestContext = Awaited<ReturnType<typeof loadDatabaseTestContext>>

async function loadDatabaseTestContext() {
    const { requestHandler } = await import('@tanstack/react-start/server')
    const { SESSION_COOKIE_NAME } = await import('../config/auth.config')
    const { db } = await import('../db')
    const { auditEvents, roles, userRoles, users } = await import('../db/schema')
    const { ensureAuthorizationRegistryInTransaction } =
        await import('../server/Auth/Access/registry.service')
    const { createSessionService } = await import('../server/Auth/Access/sessions.service')
    const { getAuthDatabase } = await import('../server/Auth/Core/database.server')
    const { listAuditEventsService } = await import('../server/Audit/audit-reader.service')
    const { appendAuditEventInTransaction } = await import('../server/Audit/audit.service')
    const { count, eq, inArray, sql } = await import('drizzle-orm')

    async function withUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
        const session = await createSessionService(userId)
        let result: T | undefined
        let failure: unknown
        const handler = requestHandler(async () => {
            try {
                result = await operation()
            } catch (error) {
                failure = error
            }
            return new Response(null, { status: failure ? 500 : 204 })
        })
        const request = new Request('http://localhost/')
        request.headers.set('cookie', `${SESSION_COOKIE_NAME}=${session.token}`)
        await handler(request, {})
        if (failure) throw failure
        return result as T
    }

    async function createUser(role: string) {
        const id = crypto.randomUUID()
        await getAuthDatabase().transaction(async (transaction) => {
            await transaction.insert(users).values({
                id,
                displayName: `Audit ${role}`,
                email: `audit-${id}@integration.invalid`,
                emailVerifiedAt: new Date(),
                status: 'active',
            })
            const roleRow = (
                await transaction.select({ id: roles.id }).from(roles).where(eq(roles.key, role))
            ).at(0)
            if (!roleRow) throw new Error(`Missing ${role} role.`)
            await transaction.insert(userRoles).values({ roleId: roleRow.id, userId: id })
        })
        return id
    }

    async function deleteUser(id: string) {
        await db.delete(users).where(eq(users.id, id))
    }

    return {
        appendAuditEventInTransaction,
        auditEvents,
        db,
        deleteUser,
        count,
        eq,
        ensureAuthorizationRegistryInTransaction,
        getAuthDatabase,
        inArray,
        listAuditEventsService,
        sql,
        withUser,
        createUser,
    }
}

describe('audit event PostgreSQL persistence', () => {
    let context: DatabaseTestContext | undefined

    afterEach(() => {
        context = undefined
    })

    integrationTest(
        'appends, rolls back with its mutation, and preserves historical actors',
        async () => {
            context = await loadDatabaseTestContext()
            const {
                appendAuditEventInTransaction,
                auditEvents,
                db,
                deleteUser,
                eq,
                getAuthDatabase,
            } = context
            await getAuthDatabase().transaction((transaction) =>
                context!.ensureAuthorizationRegistryInTransaction(transaction),
            )
            const ownerId = await context.createUser('owner')
            const historicalActorId = await context.createUser('viewer')
            const targetId = crypto.randomUUID()
            try {
                await db.transaction(async (transaction) => {
                    await appendAuditEventInTransaction(transaction, {
                        actorUserId: historicalActorId,
                        actorKind: 'user',
                        action: 'login',
                        resource: 'session',
                        targetId,
                        result: 'success',
                    })
                })
                await deleteUser(historicalActorId)
                const historical = await context.withUser(ownerId, () =>
                    context!.listAuditEventsService({
                        actorUserId: historicalActorId,
                        action: 'login',
                        resource: 'session',
                        limit: 1,
                    }),
                )
                expect(historical.events).toHaveLength(1)
                expect(historical.events[0]).toMatchObject({
                    actorUserId: historicalActorId,
                    actorDisplayName: null,
                    targetId,
                })

                const rolledBackTargetId = crypto.randomUUID()
                await expect(
                    db.transaction(async (transaction) => {
                        await appendAuditEventInTransaction(transaction, {
                            actorUserId: null,
                            actorKind: 'system',
                            action: 'apply',
                            resource: 'proxy-runtime',
                            targetId: rolledBackTargetId,
                            result: 'failure',
                            metadata: { runtimeStatus: 'failed' },
                        })
                        throw new Error('mutation failed')
                    }),
                ).rejects.toThrow('mutation failed')
                expect(
                    await db
                        .select({ id: auditEvents.id })
                        .from(auditEvents)
                        .where(eq(auditEvents.targetId, rolledBackTargetId)),
                ).toEqual([])
            } finally {
                await db.delete(auditEvents).where(eq(auditEvents.targetId, targetId))
                await deleteUser(ownerId)
                await deleteUser(historicalActorId)
            }
        },
    )

    integrationTest(
        'enforces retention and the exact 100000-row cap in one transaction',
        async () => {
            context = await loadDatabaseTestContext()
            const { appendAuditEventInTransaction, auditEvents, count, db, eq, sql } = context
            const oldTargetId = crypto.randomUUID()
            const targetId = crypto.randomUUID()
            await expect(
                db.transaction(async (transaction) => {
                    await transaction.execute(sql`
                    insert into "rentnerproxy"."audit_events"
                        ("id", "created_at", "actor_user_id", "actor_kind", "action", "resource", "target_id", "result", "metadata")
                    select uuidv7(), now() - interval '91 days', null, 'system', 'apply', 'proxy-runtime', ${oldTargetId}::uuid, 'failure', '{"runtimeStatus":"failed"}'::jsonb
                `)
                    await appendAuditEventInTransaction(transaction, {
                        actorUserId: null,
                        actorKind: 'system',
                        action: 'apply',
                        resource: 'proxy-runtime',
                        targetId,
                        result: 'success',
                    })
                    const oldRows = await transaction
                        .select({ value: count() })
                        .from(auditEvents)
                        .where(eq(auditEvents.targetId, oldTargetId))
                    expect(oldRows[0]?.value).toBe(0)

                    await transaction.execute(sql`
                    insert into "rentnerproxy"."audit_events"
                        ("id", "created_at", "actor_user_id", "actor_kind", "action", "resource", "target_id", "result", "metadata")
                    select uuidv7(), now(), null, 'system', 'apply', 'proxy-runtime', ${targetId}::uuid, 'success', '{}'::jsonb
                    from generate_series(1, 100001)
                `)
                    await appendAuditEventInTransaction(transaction, {
                        actorUserId: null,
                        actorKind: 'system',
                        action: 'apply',
                        resource: 'proxy-runtime',
                        targetId,
                        result: 'success',
                    })
                    const rows = await transaction.select({ value: count() }).from(auditEvents)
                    expect(rows[0]?.value).toBe(100_000)
                    throw new Error('rollback retention fixture')
                }),
            ).rejects.toThrow('rollback retention fixture')
            const remaining = await db
                .select({ value: count() })
                .from(auditEvents)
                .where(eq(auditEvents.targetId, targetId))
            expect(remaining[0]?.value).toBe(0)
        },
    )

    integrationTest(
        'uses the id tie-breaker for same-millisecond keyset pages and filters',
        async () => {
            context = await loadDatabaseTestContext()
            const {
                auditEvents,
                db,
                ensureAuthorizationRegistryInTransaction,
                getAuthDatabase,
                inArray,
                listAuditEventsService,
                sql,
                withUser,
            } = context
            await getAuthDatabase().transaction((transaction) =>
                ensureAuthorizationRegistryInTransaction(transaction),
            )
            const ownerId = await context.createUser('owner')
            const firstId = '0198d98a-0000-7000-8000-000000000101'
            const secondId = '0198d98a-0000-7000-8000-000000000102'
            const timestamp = new Date().toISOString()
            try {
                await db.execute(sql`
                insert into "rentnerproxy"."audit_events"
                    ("id", "created_at", "actor_user_id", "actor_kind", "action", "resource", "target_id", "result", "metadata")
                values
                    (${firstId}::uuid, ${timestamp}::timestamptz, ${ownerId}::uuid, 'user', 'update', 'user', null, 'success', '{}'::jsonb),
                    (${secondId}::uuid, ${timestamp}::timestamptz, ${ownerId}::uuid, 'user', 'update', 'user', null, 'success', '{}'::jsonb)
            `)
                const query = {
                    actorUserId: ownerId,
                    action: 'update' as const,
                    resource: 'user' as const,
                    result: 'success' as const,
                    from: new Date(Date.now() - 5_000).toISOString(),
                    to: new Date(Date.now() + 5_000).toISOString(),
                    limit: 1,
                }
                const firstPage = await withUser(ownerId, () => listAuditEventsService(query))
                expect(firstPage.events.map((event) => event.id)).toEqual([secondId])
                expect(firstPage.hasMore).toBe(true)
                const secondPage = await withUser(ownerId, () =>
                    listAuditEventsService({ ...query, cursor: firstPage.nextCursor ?? undefined }),
                )
                expect(secondPage.events.map((event) => event.id)).toEqual([firstId])
            } finally {
                await db.delete(auditEvents).where(inArray(auditEvents.id, [firstId, secondId]))
                await context.deleteUser(ownerId)
            }
        },
    )

    integrationTest('denies the viewer before the audit query is opened', async () => {
        context = await loadDatabaseTestContext()
        const {
            ensureAuthorizationRegistryInTransaction,
            getAuthDatabase,
            listAuditEventsService,
        } = context
        await getAuthDatabase().transaction((transaction) =>
            ensureAuthorizationRegistryInTransaction(transaction),
        )
        const viewerId = await context.createUser('viewer')
        try {
            await expect(
                context.withUser(viewerId, () => listAuditEventsService({})),
            ).rejects.toMatchObject({
                code: 'permission_denied',
            })
        } finally {
            await context.deleteUser(viewerId)
        }
    })
})

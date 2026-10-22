import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { sql } from 'drizzle-orm'
import * as schema from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { SESSION_LAST_SEEN_INTERVAL_MS } from '@/config/auth.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import { hashOpaqueToken } from '@/server/Auth/Core/tokens.server.ts'

const url = process.env.RENTNERPROXY_SESSIONS_FIXTURE_URL
const parsedUrl = url ? new URL(url) : undefined
if (
    !parsedUrl ||
    !['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname) ||
    parsedUrl.pathname !== '/sessions_fixture'
)
    throw new Error('Session fixture requires its dedicated sessions_fixture database')
const client = new SQL(parsedUrl.toString())
const queries: string[] = []
const database = drizzle(client, {
    schema,
    logger: {
        logQuery: (query) => {
            queries.push(query)
        },
    },
})
const userId = '00000000-0000-4000-8000-000000000022'
let allowed = true
let auditFailure = false
let onResolve: (() => Promise<void>) | undefined
const audit: Array<{ action: string; targetId?: string; metadata?: unknown }> = []
const actor = (): AuthenticatedUser => ({
    id: userId,
    email: 'session-fixture@example.invalid',
    displayName: 'Session fixture',
    profileImageVersion: null,
    roles: [],
    permissions: allowed ? [PERMISSIONS.APP_ACCESS] : [],
    language: 'en',
    themeMode: 'light',
})

// These are explicit test dependencies. Session SQL/transactions/tokens are real;
// this fixture does not claim coverage of the RBAC resolver or audit persistence.
mock.module('@/server/Auth/Core/database.server.ts', () => ({ getAuthDatabase: () => database }))
mock.module('@/server/Auth/Access/cookies.server.ts', () => ({ getSessionCookie: () => null }))
mock.module('@/server/Auth/Access/rbac.service.ts', () => ({
    resolveActiveUserAccessInTransaction: async () => {
        const hook = onResolve
        onResolve = undefined
        await hook?.()
        return actor()
    },
}))
mock.module('@/server/Audit/audit.service.ts', () => ({
    appendAuditEventInTransactionService: async (
        _transaction: unknown,
        event: (typeof audit)[number],
    ) => {
        audit.push(event)
        if (auditFailure) throw new Error('fixture audit failure')
    },
}))

const {
    createSessionService,
    getSessionByTokenService,
    pruneExpiredSessionsInTransaction,
    requireRecentSessionInTransaction,
    markSessionReauthenticatedInTransaction,
} = await import('@/server/Auth/Access/sessions.service.ts')

let checks = 0
function passed(message: string) {
    checks++
    console.log('PASS: ' + message)
}
async function reset() {
    await client`truncate rentnerproxy.sessions`
    await client`update rentnerproxy.users set status='active' where id=${userId}`
    allowed = true
    auditFailure = false
    onResolve = undefined
    audit.length = 0
    queries.length = 0
}
async function seedExpired(count: number) {
    await client`insert into rentnerproxy.sessions(user_id,token_hash,expires_at)
        select ${userId}::uuid,lpad(n::text,64,'0'),${new Date(Date.now() - 86_400_000)}::timestamptz
        from generate_series(1,${count}::int) n`
}
async function countRows() {
    return Number((await client`select count(*)::int as n from rentnerproxy.sessions`)[0]!.n)
}
async function readRow(id: string) {
    return (await client`select * from rentnerproxy.sessions where id=${id}`)[0]!
}
const touches = () =>
    queries.filter((query) => query.startsWith('update "rentnerproxy"."sessions"')).length
const cleanups = () => queries.filter((query) => query.includes('with expired as')).length

let ownedSchema = false
try {
    assert.equal((await client`select current_database() as name`)[0]!.name, 'sessions_fixture')
    await client`create schema rentnerproxy`
    ownedSchema = true
    await client.unsafe(`
        create table rentnerproxy.users (id uuid primary key, status varchar(20) not null);
        create table rentnerproxy.sessions (
            id uuid primary key default uuidv7(), user_id uuid not null references rentnerproxy.users(id) on delete cascade,
            token_hash varchar(64) not null, created_at timestamptz not null default now(),
            last_seen_at timestamptz not null default now(), reauthenticated_at timestamptz not null default now(),
            expires_at timestamptz not null
        );
        create unique index sessions_token_hash_unique_idx on rentnerproxy.sessions(token_hash);
        create index sessions_user_id_idx on rentnerproxy.sessions(user_id);
        create index sessions_expires_at_idx on rentnerproxy.sessions(expires_at);
    `)
    await client`insert into rentnerproxy.users(id,status) values(${userId},'active')`

    const now = new Date()
    await Promise.all(
        [-1, 0, 1].map(
            (offset, index) =>
                client`insert into rentnerproxy.sessions(user_id,token_hash,expires_at) values(${userId},${String(index).padStart(64, '0')},${new Date(now.getTime() + offset)})`,
        ),
    )
    await database.transaction((transaction) => pruneExpiredSessionsInTransaction(transaction, now))
    assert.equal(await countRows(), 1)
    assert.equal(
        new Date(
            (await client`select expires_at from rentnerproxy.sessions`)[0]!.expires_at,
        ).getTime(),
        now.getTime() + 1,
    )
    passed('expiry boundary deletes <=now and preserves the later session')

    await reset()
    await seedExpired(205)
    const created = await createSessionService(userId)
    const stored = await readRow(created.id)
    assert.equal(await countRows(), 106)
    assert.equal(cleanups(), 1)
    assert.equal(stored.token_hash, await hashOpaqueToken(created.token))
    assert.equal(new Date(stored.expires_at).getTime(), created.expiresAt.getTime())
    assert.equal(new Date(stored.reauthenticated_at).getTime(), created.reauthenticatedAt.getTime())
    assert.equal(audit.length, 1)
    assert.equal(audit[0]!.action, 'login')
    assert.equal(audit[0]!.targetId, created.id)
    assert.deepEqual(audit[0]!.metadata, { authenticationMethod: 'password' })
    assert.ok(!JSON.stringify(audit).includes(created.token))
    passed(
        'authorized creation removes exactly one100-row batch and retains real token/time/audit dispatch contracts',
    )

    await reset()
    await seedExpired(205)
    await Promise.all([createSessionService(userId), createSessionService(userId)])
    assert.equal(await countRows(), 7)
    assert.equal(cleanups(), 2)
    passed('parallel creations each remove at most100 distinct expired rows')

    await reset()
    await seedExpired(10)
    const held = await client.reserve()
    try {
        await held`begin`
        const [locked] =
            await held`select id from rentnerproxy.sessions order by expires_at,id limit 1 for update`
        await database.transaction(async (transaction) => {
            await transaction.execute(sql`set local statement_timeout = '500ms'`)
            await pruneExpiredSessionsInTransaction(transaction, new Date())
        })
        assert.equal(await countRows(), 1)
        assert.equal((await client`select id from rentnerproxy.sessions`)[0]!.id, locked!.id)
    } finally {
        await held`rollback`
        held.release()
    }
    passed('SKIP LOCKED bypasses the contested expired row without blocking other cleanup')

    await reset()
    await seedExpired(110)
    auditFailure = true
    await assert.rejects(createSessionService(userId), /fixture audit failure/)
    assert.equal(await countRows(), 110)
    passed('audit-dispatch failure rolls back cleanup and new session together')

    await reset()
    await seedExpired(1)
    await client`update rentnerproxy.users set status='disabled' where id=${userId}`
    await assert.rejects(
        createSessionService(userId),
        (error: unknown) => (error as { code?: string }).code === 'user_not_active',
    )
    assert.equal(await countRows(), 1)
    assert.equal(cleanups(), 0)
    await client`update rentnerproxy.users set status='active' where id=${userId}`
    allowed = false
    await assert.rejects(
        createSessionService(userId),
        (error: unknown) => (error as { code?: string }).code === 'user_not_active',
    )
    assert.equal(await countRows(), 1)
    assert.equal(cleanups(), 0)
    assert.equal(audit.length, 0)
    passed('inactive and APP_ACCESS-denied creation neither cleans nor persists a session')

    await reset()
    const current = await createSessionService(userId)
    queries.length = 0
    assert.equal(await getSessionByTokenService('invalid'), null)
    assert.equal(queries.length, 0)
    const original = await readRow(current.id)
    assert.ok(await getSessionByTokenService(current.token))
    assert.equal(touches(), 0)
    assert.equal(cleanups(), 0)
    passed('invalid tokens do not query; recent valid reads issue no UPDATE or cleanup')

    const old = new Date(Date.now() - SESSION_LAST_SEEN_INTERVAL_MS - 5_000)
    await client`update rentnerproxy.sessions set last_seen_at=${old} where id=${current.id}`
    queries.length = 0
    assert.ok(await getSessionByTokenService(current.token))
    assert.equal(touches(), 1)
    let row = await readRow(current.id)
    assert.ok(new Date(row.last_seen_at).getTime() > old.getTime())
    assert.equal(new Date(row.expires_at).getTime(), new Date(original.expires_at).getTime())
    assert.equal(
        new Date(row.reauthenticated_at).getTime(),
        new Date(original.reauthenticated_at).getTime(),
    )
    passed('old last-seen is touched once without extending expiry or recent authentication')

    const future = new Date(Date.now() + 60_000)
    await client`update rentnerproxy.sessions set last_seen_at=${old} where id=${current.id}`
    onResolve = async () => {
        await client`update rentnerproxy.sessions set last_seen_at=${future} where id=${current.id}`
    }
    queries.length = 0
    assert.ok(await getSessionByTokenService(current.token))
    assert.equal(touches(), 1)
    row = await readRow(current.id)
    assert.equal(new Date(row.last_seen_at).getTime(), future.getTime())
    queries.length = 0
    assert.ok(await getSessionByTokenService(current.token))
    assert.equal(touches(), 0)
    passed('SQL-CAS preserves a concurrent newer touch; selected future timestamp skips UPDATE')

    allowed = false
    queries.length = 0
    assert.equal(await getSessionByTokenService(current.token), null)
    assert.equal(touches(), 0)
    allowed = true
    await client`update rentnerproxy.sessions set reauthenticated_at=${old} where id=${current.id}`
    const oldAuthentication = await getSessionByTokenService(current.token)
    assert.ok(oldAuthentication)
    await assert.rejects(
        database.transaction((transaction) =>
            requireRecentSessionInTransaction(transaction, oldAuthentication),
        ),
        (error: unknown) => (error as { code?: string }).code === 'reauthentication_required',
    )
    await client`update rentnerproxy.sessions set expires_at=${new Date(Date.now() - 1)} where id=${current.id}`
    assert.equal(await getSessionByTokenService(current.token), null)
    assert.equal(
        await database.transaction((transaction) =>
            markSessionReauthenticatedInTransaction(transaction, oldAuthentication),
        ),
        false,
    )
    passed('permission denial, expiration and recent-authentication boundaries remain enforced')
    console.log(
        'PASS: ' +
            checks +
            ' targeted PostgreSQL session checks; RBAC and audit persistence explicitly mocked',
    )
} finally {
    try {
        if (ownedSchema) await client`drop schema rentnerproxy cascade`
    } finally {
        await client.close()
    }
}

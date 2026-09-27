import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { requestHandler } from '@tanstack/react-start/server'
import { eq, inArray, like } from 'drizzle-orm'

import { SESSION_COOKIE_NAME } from '../config/auth.config'
import { PERMISSIONS, SYSTEM_ROLES } from '../config/permissions.config'
import {
    auditEvents,
    hostDomains,
    npmImportRuns,
    permissions,
    proxyHosts,
    redirectHosts,
    rolePermissions,
    roles,
    userRoles,
    users,
} from '../db/schema'
import { ensureAuthorizationRegistryInTransaction } from '../server/Auth/Access/registry.service'
import { createSessionService } from '../server/Auth/Access/sessions.service'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import { AuthDomainError } from '../server/Auth/Core/errors.server'
import {
    applyNpmImportService,
    NpmImportError,
    previewNpmImportService,
} from '../server/Admin/NpmImport/npm-import.service'
import { createProxyHostService } from '../server/Admin/ProxyHostManagement/proxy-hosts.service'
import { NPM_216_MIGRATIONS } from '../server/Admin/NpmImport/npm-source'
import { getDatabaseUrl } from '../server/env.server'

const DATABASE_INTEGRATION_ENABLED =
    process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = DATABASE_INTEGRATION_ENABLED ? test : test.skip
const SUFFIX = '.npm-import-test.invalid'
const EMAIL_SUFFIX = '@npm-import-test.invalid'
const testDirectories: string[] = []
const userIds: string[] = []
const roleIds: string[] = []

async function sourceFixture(): Promise<{
    path: string
    fingerprint: string
    domain: string
    redirectDomain: string
}> {
    const directory = await mkdtemp(join(tmpdir(), 'rp-npm-integration-'))
    testDirectories.push(directory)
    const path = join(directory, 'database.sqlite')
    const domain = `proxy-${randomUUID().slice(0, 12)}${SUFFIX}`
    const redirectDomain = `redirect-${randomUUID().slice(0, 12)}${SUFFIX}`
    const db = new Database(path, { create: true })
    db.exec(`
        create table knex_migrations (id integer primary key, name text not null);
        create table proxy_host (id integer primary key, is_deleted integer default 0,
            domain_names text, forward_scheme text, forward_host text, forward_port integer,
            access_list_id integer default 0, certificate_id integer default 0,
            ssl_forced integer default 0, caching_enabled integer default 0,
            block_exploits integer default 0, advanced_config text default '',
            allow_websocket_upgrade integer default 1, http2_support integer default 0,
            enabled integer default 1, locations text, hsts_enabled integer default 0,
            hsts_subdomains integer default 0, trust_forwarded_proto integer default 0);
        create table redirection_host (id integer primary key, is_deleted integer default 0,
            domain_names text, forward_domain_name text, forward_scheme text,
            forward_http_code integer, preserve_path integer, certificate_id integer default 0,
            ssl_forced integer default 0, block_exploits integer default 0,
            advanced_config text default '', http2_support integer default 0,
            enabled integer default 1, hsts_enabled integer default 0,
            hsts_subdomains integer default 0);
        create table access_list (id integer primary key, is_deleted integer default 0,
            name text, satisfy_any integer default 0, pass_auth integer default 1);
        create table access_list_auth (id integer primary key, access_list_id integer);
        create table access_list_client (id integer primary key, access_list_id integer,
            address text, directive text);
        create table certificate (id integer primary key, is_deleted integer default 0,
            provider text, nice_name text, domain_names text);
        create table dead_host (id integer primary key, is_deleted integer default 0,
            domain_names text default '[]');
        create table stream (id integer primary key, is_deleted integer default 0,
            incoming_port integer default 0);
    `)
    const migration = db.query('insert into knex_migrations (name) values (?)')
    for (const name of NPM_216_MIGRATIONS) migration.run(name)
    db.query(`insert into proxy_host (id, domain_names, forward_scheme, forward_host,
        forward_port) values (1, ?, 'http', 'backend.example.test', 8080)`).run(
        JSON.stringify([domain]),
    )
    db.query(`insert into redirection_host (id, domain_names, forward_domain_name,
        forward_scheme, forward_http_code, preserve_path)
        values (2, ?, 'target.example.test', 'https', 302, 1)`).run(
        JSON.stringify([redirectDomain]),
    )
    db.close()
    const fingerprint = createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
    return { path, fingerprint, domain, redirectDomain }
}

async function createUser(roleKey: string): Promise<string> {
    const email = `user-${randomUUID()}${EMAIL_SUFFIX}`
    const db = getAuthDatabase()
    const rows = await db
        .insert(users)
        .values({
            displayName: 'NPM import test',
            email,
            emailVerifiedAt: new Date(),
            status: 'active',
        })
        .returning({ id: users.id })
    const userId = rows[0]!.id
    const role = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.key, roleKey))
        .limit(1)
    await db.insert(userRoles).values({ userId, roleId: role[0]!.id })
    userIds.push(userId)
    return userId
}

async function createLimitedRole(): Promise<string> {
    const key = `npm-import-test-${randomUUID()}`
    const db = getAuthDatabase()
    const rows = await db
        .insert(roles)
        .values({ key, name: 'NPM import limited', description: 'Transaction rollback test' })
        .returning({ id: roles.id })
    const roleId = rows[0]!.id
    roleIds.push(roleId)
    const selected = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(
            inArray(permissions.key, [
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.NPM_IMPORT,
                PERMISSIONS.PROXY_HOSTS_CREATE,
            ]),
        )
    await db.insert(rolePermissions).values(
        selected.map((permission) => ({
            roleId,
            permissionId: permission.id,
        })),
    )
    return key
}

async function runAsUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
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

async function cleanup(): Promise<void> {
    if (DATABASE_INTEGRATION_ENABLED) {
        const db = getAuthDatabase()
        const domains = await db
            .select()
            .from(hostDomains)
            .where(like(hostDomains.domain, `%${SUFFIX}`))
        const proxyIds = domains.flatMap((row) => (row.proxyHostId ? [row.proxyHostId] : []))
        const redirectIds = domains.flatMap((row) =>
            row.redirectHostId ? [row.redirectHostId] : [],
        )
        if (proxyIds.length) await db.delete(proxyHosts).where(inArray(proxyHosts.id, proxyIds))
        if (redirectIds.length)
            await db.delete(redirectHosts).where(inArray(redirectHosts.id, redirectIds))
        if (userIds.length) {
            await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds))
            await db.delete(npmImportRuns).where(inArray(npmImportRuns.actorUserId, userIds))
            await db.delete(users).where(inArray(users.id, userIds))
        }
        if (roleIds.length) await db.delete(roles).where(inArray(roles.id, roleIds))
    }
    userIds.length = 0
    roleIds.length = 0
    await Promise.all(
        testDirectories
            .splice(0)
            .map((directory) => rm(directory, { recursive: true, force: true })),
    )
}

beforeAll(async () => {
    if (!DATABASE_INTEGRATION_ENABLED) return
    await getAuthDatabase().transaction((transaction) =>
        ensureAuthorizationRegistryInTransaction(transaction),
    )
})
afterEach(cleanup)

describe('NPM import with PostgreSQL', () => {
    integrationTest('preview does not write and unauthorized users cannot preview', async () => {
        const fixture = await sourceFixture()
        const viewer = await createUser(SYSTEM_ROLES.VIEWER)
        await expect(
            runAsUser(viewer, () => previewNpmImportService(fixture.path, fixture.fingerprint)),
        ).rejects.toBeInstanceOf(AuthDomainError)
        const owner = await createUser(SYSTEM_ROLES.OWNER)
        const before = await getAuthDatabase().select().from(npmImportRuns)
        const preview = await runAsUser(owner, () =>
            previewNpmImportService(fixture.path, fixture.fingerprint),
        )
        expect(preview.counts.ready).toBe(2)
        expect(await getAuthDatabase().select().from(npmImportRuns)).toEqual(before)
        expect(
            await getAuthDatabase()
                .select()
                .from(hostDomains)
                .where(eq(hostDomains.domain, fixture.domain)),
        ).toHaveLength(0)
    })

    integrationTest(
        'commit, audit, and retry are durable and do not duplicate domains',
        async () => {
            const fixture = await sourceFixture()
            const owner = await createUser(SYSTEM_ROLES.OWNER)
            const preview = await runAsUser(owner, () =>
                previewNpmImportService(fixture.path, fixture.fingerprint),
            )
            const result = await runAsUser(owner, () =>
                applyNpmImportService(
                    fixture.path,
                    fixture.fingerprint,
                    preview.fingerprint,
                    preview.planFingerprint,
                ),
            )
            expect(result.imported).toBe(2)
            expect(result.skipped).toBe(0)
            expect(
                await getAuthDatabase()
                    .select()
                    .from(hostDomains)
                    .where(eq(hostDomains.domain, fixture.domain)),
            ).toHaveLength(1)
            expect(
                await getAuthDatabase()
                    .select()
                    .from(hostDomains)
                    .where(eq(hostDomains.domain, fixture.redirectDomain)),
            ).toHaveLength(1)
            const audit = await getAuthDatabase()
                .select()
                .from(auditEvents)
                .where(eq(auditEvents.targetId, result.runId))
            expect(
                audit.some((row) => row.resource === 'npm-import' && row.action === 'import'),
            ).toBe(true)
            expect(JSON.stringify(audit)).not.toContain('database.sqlite')
            const retryPreview = await runAsUser(owner, () =>
                previewNpmImportService(fixture.path, fixture.fingerprint),
            )
            expect(retryPreview.counts.conflict).toBe(2)
            const retry = await runAsUser(owner, () =>
                applyNpmImportService(
                    fixture.path,
                    fixture.fingerprint,
                    retryPreview.fingerprint,
                    retryPreview.planFingerprint,
                ),
            )
            expect(retry.imported).toBe(0)
            expect(retry.skipped).toBe(2)
        },
    )

    integrationTest(
        'a permission failure after the first host rolls back the whole import',
        async () => {
            const fixture = await sourceFixture()
            const role = await createLimitedRole()
            const actor = await createUser(role)
            const preview = await runAsUser(actor, () =>
                previewNpmImportService(fixture.path, fixture.fingerprint),
            )
            await expect(
                runAsUser(actor, () =>
                    applyNpmImportService(
                        fixture.path,
                        fixture.fingerprint,
                        preview.fingerprint,
                        preview.planFingerprint,
                    ),
                ),
            ).rejects.toBeInstanceOf(AuthDomainError)
            expect(
                await getAuthDatabase()
                    .select()
                    .from(hostDomains)
                    .where(eq(hostDomains.domain, fixture.domain)),
            ).toHaveLength(0)
            expect(
                await getAuthDatabase()
                    .select()
                    .from(npmImportRuns)
                    .where(eq(npmImportRuns.actorUserId, actor)),
            ).toHaveLength(0)
        },
    )

    integrationTest('rejects a stale preview after another host claims its domain', async () => {
        const fixture = await sourceFixture()
        const owner = await createUser(SYSTEM_ROLES.OWNER)
        const preview = await runAsUser(owner, () =>
            previewNpmImportService(fixture.path, fixture.fingerprint),
        )
        await runAsUser(owner, () =>
            createProxyHostService({
                domains: [fixture.domain],
                forwardScheme: 'http',
                forwardHost: 'other.example.test',
                forwardPort: 8080,
                enabled: true,
            }),
        )
        await expect(
            runAsUser(owner, () =>
                applyNpmImportService(
                    fixture.path,
                    fixture.fingerprint,
                    preview.fingerprint,
                    preview.planFingerprint,
                ),
            ),
        ).rejects.toBeInstanceOf(NpmImportError)
        expect(
            await getAuthDatabase()
                .select()
                .from(hostDomains)
                .where(eq(hostDomains.domain, fixture.redirectDomain)),
        ).toHaveLength(0)
    })
})

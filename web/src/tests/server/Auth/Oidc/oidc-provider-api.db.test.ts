import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { OIDC_CONFIGURATION_RATE_LIMIT, OIDC_SETTINGS_KEY } from '@/config/oidc.config.ts'
import { auditEvents, roles, systemSettings, userRoles, users } from '@/db/schema.ts'
import { getDatabaseUrl, getValkeyUrl } from '@/server/env.server.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { hashPassword } from '@/server/Auth/Core/password.server.ts'
import {
    lockStoredOidcSettings,
    readStoredOidcSettings,
    writeStoredOidcSettings,
} from '@/server/Auth/Oidc/oidc-settings.server.ts'
import type { StoredOidcSettings } from '@/server/Auth/Oidc/Types/oidc-provider.types.ts'
import { closeValkeyClient, getValkeyClient } from '@/server/Valkey/client.server.ts'
import { createRateLimitKey } from '@/server/Valkey/rate-limiter.service.ts'

const enabled =
    process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' &&
    process.env.RENTNERPROXY_VALKEY_INTEGRATION === '1' &&
    getDatabaseUrl() !== null &&
    getValkeyUrl() !== null
const integrationTest = enabled ? test : test.skip
const origin = 'https://proxy.example.test'
let currentCookie: string | null = null

// Only the HTTP cookie accessor is replaced; sessions, authorization, settings and audit use PostgreSQL.
mock.module('@/server/Auth/Access/cookies.server.ts', () => ({
    getSessionCookie: () => currentCookie,
}))
const { createSessionService } = await import('@/server/Auth/Access/sessions.service.ts')
const { handleOidcProviderRequest } =
    await import('@/server/Auth/Oidc/oidc-provider-response.server.ts')

let snapshot: StoredOidcSettings | undefined
let fixtureReady = false
let originalEncryptionKey: string | undefined
let originalOrigin: string | undefined
let passwordHash = ''
let ownerRoleId = ''
let viewerRoleId = ''
let ownerId = ''
let ownerToken = ''
let viewerToken = ''
let staleOwnerToken = ''
const userIds: string[] = []
const rateLimitKeys = new Set<string>()

/** Exercises the real JSON handler with the current fixture's stored session cookie. */
async function request(method: 'GET' | 'POST', body?: unknown, requestOrigin = origin) {
    const response = await handleOidcProviderRequest(
        new Request(origin + '/api/admin/oidc/providers', {
            method,
            ...(method === 'POST'
                ? {
                      headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
                      body: JSON.stringify(body),
                  }
                : {}),
        }),
    )
    expect(response.headers.get('cache-control')).toContain('no-store')
    return response
}

/** Reads durable state independently of the HTTP response and request authorization. */
async function storedSettings() {
    return getAuthDatabase().transaction((transaction) => readStoredOidcSettings(transaction))
}

/** Restores only the OIDC singleton snapshot while retaining monotonic configuration history. */
async function restoreSettings() {
    const saved = snapshot
    if (!saved) return
    await getAuthDatabase().transaction(async (transaction) => {
        const current = await lockStoredOidcSettings(transaction)
        await writeStoredOidcSettings(transaction, { ...saved, revision: current.revision + 1 })
    })
}

beforeAll(async () => {
    if (!enabled) return
    if (new URL(getDatabaseUrl()!).pathname !== '/rentnerproxy_upstream_test')
        throw new Error('OIDC provider API integration requires the disposable test database.')
    if (process.env.APP_ENCRYPTION_KEY_FILE)
        throw new Error('Integration fixtures require an inline synthetic encryption key.')
    originalEncryptionKey = process.env.APP_ENCRYPTION_KEY
    originalOrigin = process.env.PUBLIC_ORIGIN
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 41).toString('base64')
    process.env.PUBLIC_ORIGIN = origin
    passwordHash = await hashPassword('synthetic owner API fixture password')
    snapshot = await getAuthDatabase().transaction((transaction) =>
        lockStoredOidcSettings(transaction),
    )
    const registered = await getAuthDatabase()
        .select({ id: roles.id, key: roles.key })
        .from(roles)
        .where(inArray(roles.key, ['owner', 'viewer']))
    const ownerRole = registered.find((role) => role.key === 'owner')
    const viewerRole = registered.find((role) => role.key === 'viewer')
    if (!ownerRole || !viewerRole)
        throw new Error('Migrate the disposable database to register owner and viewer roles.')
    ownerRoleId = ownerRole.id
    viewerRoleId = viewerRole.id
    const client = getValkeyClient()
    if (!client || (await client.ping()) !== 'PONG')
        throw new Error('Disposable Valkey is unavailable.')
    fixtureReady = true
})

beforeEach(async () => {
    if (!fixtureReady) return
    ownerId = randomUUID()
    const viewerId = randomUUID()
    userIds.push(ownerId, viewerId)
    await getAuthDatabase().transaction(async (transaction) => {
        await transaction.insert(users).values([
            {
                id: ownerId,
                displayName: 'API owner',
                email: `oidc-api-${ownerId}@auth-test.invalid`,
                status: 'active',
                passwordHash,
            },
            {
                id: viewerId,
                displayName: 'API viewer',
                email: `oidc-api-${viewerId}@auth-test.invalid`,
                status: 'active',
                passwordHash,
            },
        ])
        await transaction.insert(userRoles).values([
            { userId: ownerId, roleId: ownerRoleId },
            { userId: viewerId, roleId: viewerRoleId },
        ])
    })
    const owner = await createSessionService(ownerId, 'password')
    const viewer = await createSessionService(viewerId, 'password')
    const staleOwner = await createSessionService(ownerId, 'oidc')
    expect(staleOwner.reauthenticatedAt.getTime()).toBe(0)
    ownerToken = owner.token
    viewerToken = viewer.token
    staleOwnerToken = staleOwner.token
    currentCookie = ownerToken
    rateLimitKeys.add(createRateLimitKey(OIDC_CONFIGURATION_RATE_LIMIT.scope, ownerId))
})

afterEach(async () => {
    currentCookie = null
    if (!fixtureReady) return
    try {
        const client = getValkeyClient()
        if (!client) throw new Error('Disposable Valkey is unavailable during cleanup.')
        if (rateLimitKeys.size > 0) await client.send('DEL', [...rateLimitKeys])
    } finally {
        rateLimitKeys.clear()
        await restoreSettings()
        if (userIds.length > 0) {
            await getAuthDatabase()
                .delete(auditEvents)
                .where(inArray(auditEvents.actorUserId, userIds))
            await getAuthDatabase().delete(users).where(inArray(users.id, userIds))
            userIds.length = 0
        }
    }
})

afterAll(async () => {
    if (!enabled || !snapshot) return
    try {
        await restoreSettings()
        if (userIds.length > 0) {
            await getAuthDatabase()
                .delete(auditEvents)
                .where(inArray(auditEvents.actorUserId, userIds))
            await getAuthDatabase().delete(users).where(inArray(users.id, userIds))
        }
    } finally {
        if (originalEncryptionKey === undefined) delete process.env.APP_ENCRYPTION_KEY
        else process.env.APP_ENCRYPTION_KEY = originalEncryptionKey
        if (originalOrigin === undefined) delete process.env.PUBLIC_ORIGIN
        else process.env.PUBLIC_ORIGIN = originalOrigin
        closeValkeyClient()
    }
})

describe('OIDC owner JSON API with actual authorization, settings and audit persistence', () => {
    integrationTest(
        'persists an owner mutation with encrypted credentials and a nullable global audit target',
        async () => {
            const initialResponse = await request('GET')
            expect(initialResponse.status).toBe(200)
            const initial = (await initialResponse.json()) as {
                revision: number
                providers: unknown[]
            }
            expect(initial.providers).toHaveLength(snapshot?.providers.length ?? 0)
            const secret = 'synthetic API provider credential'
            const response = await request('POST', {
                expectedRevision: initial.revision,
                providers: [
                    {
                        id: randomUUID(),
                        name: 'API IdP',
                        enabled: true,
                        issuer: 'https://identity.example.test',
                        clientId: 'synthetic-client',
                        clientSecret: secret,
                        tokenEndpointAuthMethod: 'client_secret_basic',
                        allowedEndpointOrigins: ['https://identity.example.test'],
                        allowedPrivateCidrs: [],
                        bindings: [{ subject: 'explicit-existing-owner', userId: ownerId }],
                    },
                ],
            })
            expect(response.status).toBe(200)
            const summary = (await response.json()) as {
                revision: number
                providers: Record<string, unknown>[]
            }
            expect(summary.revision).toBe(initial.revision + 1)
            expect(summary.providers).toHaveLength(1)
            expect(summary.providers[0]?.credentialConfigured).toBeTrue()
            expect(summary.providers[0]).not.toHaveProperty('clientSecret')
            expect(JSON.stringify(summary)).not.toContain(secret)
            expect(JSON.stringify(summary)).not.toContain('ciphertext')
            const [row] = await getAuthDatabase()
                .select({ value: systemSettings.value })
                .from(systemSettings)
                .where(eq(systemSettings.key, OIDC_SETTINGS_KEY))
            expect(typeof row?.value).toBe('object')
            const saved = await storedSettings()
            expect(saved.revision).toBe(summary.revision)
            expect(saved.providers[0]?.clientSecret.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/u)
            expect(JSON.stringify(saved)).not.toContain(secret)
            const events = await getAuthDatabase()
                .select({
                    targetId: auditEvents.targetId,
                    result: auditEvents.result,
                    metadata: auditEvents.metadata,
                })
                .from(auditEvents)
                .where(
                    and(
                        eq(auditEvents.actorUserId, ownerId),
                        eq(auditEvents.action, 'update'),
                        eq(auditEvents.resource, 'security-settings'),
                    ),
                )
            expect(events).toEqual([
                {
                    targetId: null,
                    result: 'success',
                    metadata: { changedFields: ['oidcProviders'] },
                },
            ])
            const reread = await request('GET')
            expect(reread.status).toBe(200)
            expect(await reread.json()).toEqual(summary)
        },
    )

    for (const actor of ['viewer', 'oidc-owner', 'anonymous'] as const) {
        integrationTest(
            `rejects ${actor} reads and writes without changing the durable revision`,
            async () => {
                const before = await storedSettings()
                currentCookie =
                    actor === 'viewer'
                        ? viewerToken
                        : actor === 'oidc-owner'
                          ? staleOwnerToken
                          : null
                const status = actor === 'anonymous' ? 401 : 403
                const error =
                    actor === 'viewer'
                        ? 'owner_required'
                        : actor === 'oidc-owner'
                          ? 'reauthentication_required'
                          : 'authentication_required'
                for (const method of ['GET', 'POST'] as const) {
                    // oxlint-disable-next-line no-await-in-loop -- Each boundary must be checked against the same durable revision.
                    const response = await request(method, {
                        expectedRevision: before.revision,
                        providers: [],
                    })
                    expect(response.status).toBe(status)
                    // oxlint-disable-next-line no-await-in-loop -- Read the preceding response before the next request.
                    expect(await response.json()).toEqual({ error })
                }
                expect(await storedSettings()).toEqual(before)
            },
        )
    }

    integrationTest(
        'rejects a foreign-origin owner mutation before changing settings or audit',
        async () => {
            const before = await storedSettings()
            const response = await request(
                'POST',
                { expectedRevision: before.revision, providers: [] },
                'https://foreign.example.test',
            )
            expect(response.status).toBe(403)
            expect(await response.json()).toEqual({ error: 'permission_denied' })
            expect(await storedSettings()).toEqual(before)
            const events = await getAuthDatabase()
                .select({ id: auditEvents.id })
                .from(auditEvents)
                .where(and(eq(auditEvents.actorUserId, ownerId), eq(auditEvents.action, 'update')))
            expect(events).toEqual([])
        },
    )
})

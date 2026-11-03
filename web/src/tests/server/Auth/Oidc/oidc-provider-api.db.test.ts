import { randomUUID } from 'node:crypto'
import { SQL } from 'bun'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { OIDC_CONFIGURATION_RATE_LIMIT, OIDC_SETTINGS_KEY } from '@/config/oidc.config.ts'
import { auditEvents, roles, sessions, systemSettings, userRoles, users } from '@/db/schema.ts'
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
import {
    captureRestoreSessionsSql,
    mergeRestoreSessionsSql,
} from '../../../../../../scripts/backup/restore-session-continuity.ts'

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
const { createSessionService, getSessionByTokenService } =
    await import('@/server/Auth/Access/sessions.service.ts')
const {
    authorizeOidcLinkService,
    completeOidcLinkService,
    getOidcConnectionsService,
    unlinkOidcConnectionService,
} = await import('@/server/Auth/Oidc/oidc-linking.service.ts')
const { getOidcClientConfigurationService } =
    await import('@/server/Auth/Oidc/oidc-providers.service.ts')
const { authenticateOidcIdentityService } = await import('@/server/Auth/Oidc/oidc-login.service.ts')
const { handleOidcProviderRequest } =
    await import('@/server/Auth/Oidc/oidc-provider-response.server.ts')
const { handleOidcProviderTestRequest } =
    await import('@/server/Auth/Oidc/oidc-provider-test-response.server.ts')

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

/** Installs a real encrypted provider without assuming any pre-existing external account. */
async function linkProvider() {
    const current = await storedSettings()
    const providerId = randomUUID()
    const response = await request('POST', {
        expectedRevision: current.revision,
        providers: [
            ...current.providers.map(
                ({ revision: _revision, clientSecret: _secret, ...provider }) => provider,
            ),
            {
                id: providerId,
                name: 'Self-service linking',
                enabled: true,
                issuer: 'https://linking.example.test',
                clientId: 'linking-client',
                clientSecret: 'synthetic-linking-secret',
                tokenEndpointAuthMethod: 'client_secret_basic',
                allowedEndpointOrigins: ['https://linking.example.test'],
                allowedPrivateCidrs: [],
                bindings: [],
            },
        ],
    })
    expect(response.status).toBe(200)
    return getOidcClientConfigurationService(providerId)
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
    const staleOwner = await createSessionService(ownerId, 'password')
    await getAuthDatabase()
        .update(sessions)
        .set({ reauthenticatedAt: new Date(0) })
        .where(eq(sessions.id, staleOwner.id))
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
        'preserves current local sessions across restore without restoring OIDC proof as local authentication',
        async () => {
            const configuration = await linkProvider()
            const identity = {
                issuer: configuration.issuer,
                subject: 'restore-subject',
                expiresAt: Date.now() + 120_000,
            }
            await completeOidcLinkService(
                configuration,
                identity,
                await authorizeOidcLinkService(configuration.providerId),
            )
            const login = await authenticateOidcIdentityService(configuration, identity)
            if (!login.success || login.requiresTwoFactor)
                throw new Error('Fixture OIDC session was not issued.')
            const client = new SQL(getDatabaseUrl()!, { max: 1 })
            try {
                const rows = await client.unsafe(captureRestoreSessionsSql).values()
                const currentSessionsSnapshot: unknown = rows[0]?.[0]
                if (typeof currentSessionsSnapshot !== 'string')
                    throw new Error('Missing captured sessions.')
                expect(currentSessionsSnapshot).not.toContain(login.session.id)
                await client.unsafe(mergeRestoreSessionsSql(currentSessionsSnapshot)).simple()
                expect(await getSessionByTokenService(ownerToken)).not.toBeNull()
                expect(await getSessionByTokenService(viewerToken)).not.toBeNull()
                expect(await getSessionByTokenService(login.session.token)).toBeNull()
                const retained = await getAuthDatabase()
                    .select({ proof: sessions.oidcProof })
                    .from(sessions)
                expect(retained.length).toBeGreaterThanOrEqual(2)
                expect(retained.every((entry) => entry.proof === null)).toBeTrue()
            } finally {
                await client.close()
            }
        },
    )

    integrationTest(
        'links and unlinks only the consenting local user without invalidating unrelated sessions',
        async () => {
            const configuration = await linkProvider()
            const identity = {
                issuer: configuration.issuer,
                subject: 'owner-subject',
                expiresAt: Date.now() + 120_000,
            }
            const ownerTarget = await authorizeOidcLinkService(configuration.providerId)
            await completeOidcLinkService(configuration, identity, ownerTarget)
            const first = await authenticateOidcIdentityService(configuration, identity)
            if (!first.success || first.requiresTwoFactor)
                throw new Error('Linked owner sign-in failed.')
            const firstProof = (
                await getAuthDatabase()
                    .select()
                    .from(sessions)
                    .where(eq(sessions.id, first.session.id))
            )[0]?.oidcProof
            expect(firstProof?.bindingGeneration).toBeGreaterThan(0)
            currentCookie = viewerToken
            const viewerTarget = await authorizeOidcLinkService(configuration.providerId)
            rateLimitKeys.add(
                createRateLimitKey(OIDC_CONFIGURATION_RATE_LIMIT.scope, viewerTarget.userId),
            )
            const viewerIdentity = { ...identity, subject: 'viewer-subject' }
            await completeOidcLinkService(configuration, viewerIdentity, viewerTarget)
            const viewer = await authenticateOidcIdentityService(configuration, viewerIdentity)
            if (!viewer.success || viewer.requiresTwoFactor)
                throw new Error('Linked viewer sign-in failed.')
            expect(await getSessionByTokenService(first.session.token)).not.toBeNull()
            expect((await getOidcConnectionsService()).providers).toEqual([
                {
                    id: configuration.providerId,
                    name: 'Self-service linking',
                    enabled: true,
                    linked: true,
                },
            ])

            currentCookie = ownerToken
            await unlinkOidcConnectionService({
                providerId: configuration.providerId,
                expectedRevision: (await storedSettings()).revision,
            })
            expect(await getSessionByTokenService(first.session.token)).toBeNull()
            expect(await getSessionByTokenService(ownerToken)).not.toBeNull()
            expect(await getSessionByTokenService(viewer.session.token)).not.toBeNull()
            const relinkTarget = await authorizeOidcLinkService(configuration.providerId)
            await completeOidcLinkService(configuration, identity, relinkTarget)
            const relinked = await authenticateOidcIdentityService(configuration, identity)
            if (!relinked.success || relinked.requiresTwoFactor)
                throw new Error('Relink sign-in failed.')
            expect(await getSessionByTokenService(first.session.token)).toBeNull()
            expect(await getSessionByTokenService(relinked.session.token)).not.toBeNull()
            expect(
                (await storedSettings()).providers.find(
                    (entry) => entry.id === configuration.providerId,
                )?.revision,
            ).toBe(configuration.revision)
        },
    )

    integrationTest(
        'rejects switched sessions and accepts older active sessions before binding an external identity',
        async () => {
            const configuration = await linkProvider()
            const target = await authorizeOidcLinkService(configuration.providerId)
            const before = await storedSettings()
            currentCookie = viewerToken
            await expect(
                completeOidcLinkService(
                    configuration,
                    {
                        issuer: configuration.issuer,
                        subject: 'switched-subject',
                        expiresAt: Date.now() + 120_000,
                    },
                    target,
                ),
            ).rejects.toMatchObject({ code: 'authentication_required' })
            currentCookie = staleOwnerToken
            expect(await authorizeOidcLinkService(configuration.providerId)).toMatchObject({
                sessionId: expect.any(String),
            })
            expect(await storedSettings()).toEqual(before)
        },
    )

    integrationTest(
        'serializes concurrent claims of one external subject and invalidates stale linking consent',
        async () => {
            const configuration = await linkProvider()
            const ownerTarget = await authorizeOidcLinkService(configuration.providerId)
            currentCookie = viewerToken
            const viewerTarget = await authorizeOidcLinkService(configuration.providerId)
            rateLimitKeys.add(
                createRateLimitKey(OIDC_CONFIGURATION_RATE_LIMIT.scope, viewerTarget.userId),
            )
            const identity = {
                issuer: configuration.issuer,
                subject: 'concurrent-subject',
                expiresAt: Date.now() + 120_000,
            }
            // Capture each request's session synchronously before the first asynchronous database operation.
            currentCookie = ownerToken
            const first = completeOidcLinkService(configuration, identity, ownerTarget)
            currentCookie = viewerToken
            const second = completeOidcLinkService(configuration, identity, viewerTarget)
            const results = await Promise.allSettled([first, second])
            expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
            expect(results.filter((entry) => entry.status === 'rejected')).toHaveLength(1)
            const bindings = (await storedSettings()).providers.find(
                (entry) => entry.id === configuration.providerId,
            )!.bindings
            expect(bindings).toHaveLength(1)
            expect([ownerTarget.userId, viewerTarget.userId]).toContain(bindings[0]!.userId)
            currentCookie = bindings[0]!.userId === ownerId ? ownerToken : viewerToken
            const stale = await authorizeOidcLinkService(configuration.providerId)
            await unlinkOidcConnectionService({
                providerId: configuration.providerId,
                expectedRevision: stale.expectedRevision,
            })
            await expect(
                completeOidcLinkService(configuration, identity, stale),
            ).rejects.toMatchObject({ code: 'configuration_conflict' })
            expect(
                (await storedSettings()).providers.find(
                    (entry) => entry.id === configuration.providerId,
                )?.bindings,
            ).toEqual([])
        },
    )

    integrationTest(
        'protects saved-provider probes with real owner authorization and redacted failure responses',
        async () => {
            const initial = await storedSettings()
            const providerId = randomUUID()
            const secret = 'synthetic probe credential never sent'
            const savedResponse = await request('POST', {
                expectedRevision: initial.revision,
                providers: [
                    {
                        id: providerId,
                        name: 'Disabled probe fixture',
                        enabled: false,
                        issuer: 'https://oidc-probe.invalid',
                        clientId: 'synthetic-probe-client',
                        clientSecret: secret,
                        tokenEndpointAuthMethod: 'client_secret_basic',
                        allowedEndpointOrigins: ['https://oidc-probe.invalid'],
                        allowedPrivateCidrs: [],
                        bindings: [],
                    },
                ],
            })
            expect(savedResponse.status).toBe(200)
            const saved = await storedSettings()
            async function probe(revision = saved.revision) {
                const response = await handleOidcProviderTestRequest(
                    new Request(origin + '/api/admin/oidc/providers/test', {
                        method: 'POST',
                        headers: { Origin: origin, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ providerId, expectedRevision: revision }),
                    }),
                )
                expect(response.headers.get('cache-control')).toContain('no-store')
                expect(response.headers.get('x-content-type-options')).toBe('nosniff')
                return response
            }
            for (const [cookie, status, code] of [
                [viewerToken, 403, 'owner_required'],
                [null, 401, 'authentication_required'],
            ] as const) {
                currentCookie = cookie
                // oxlint-disable-next-line no-await-in-loop -- Each request needs its own fixture session cookie.
                const response = await probe()
                expect(response.status).toBe(status)
                // oxlint-disable-next-line no-await-in-loop -- Inspect the preceding response before replacing its session.
                expect(await response.json()).toEqual({ error: code })
            }
            currentCookie = ownerToken
            const conflict = await probe(initial.revision)
            expect(conflict.status).toBe(409)
            expect(await conflict.json()).toEqual({ error: 'configuration_conflict' })
            const unavailable = await probe()
            expect(unavailable.status).toBe(503)
            const text = await unavailable.text()
            expect(JSON.parse(text)).toEqual({ error: 'provider_unavailable' })
            expect(text).not.toContain(secret)
            expect(text).not.toContain('synthetic-probe-client')
            expect(text).not.toContain('oidc-probe.invalid')
            expect(await storedSettings()).toEqual(saved)
            const events = await getAuthDatabase()
                .select({ id: auditEvents.id })
                .from(auditEvents)
                .where(
                    and(
                        eq(auditEvents.actorUserId, ownerId),
                        eq(auditEvents.resource, 'security-settings'),
                        eq(auditEvents.action, 'update'),
                    ),
                )
            expect(events).toHaveLength(1)
        },
        15_000,
    )

    integrationTest(
        'persists an older-session owner mutation with encrypted credentials and a nullable global audit target',
        async () => {
            currentCookie = staleOwnerToken
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

    for (const actor of ['viewer', 'anonymous'] as const) {
        integrationTest(
            `rejects ${actor} reads and writes without changing the durable revision`,
            async () => {
                const before = await storedSettings()
                currentCookie = actor === 'viewer' ? viewerToken : null
                const status = actor === 'anonymous' ? 401 : 403
                const error = actor === 'viewer' ? 'owner_required' : 'authentication_required'
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

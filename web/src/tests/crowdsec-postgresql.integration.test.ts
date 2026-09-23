import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { requestHandler } from '@tanstack/react-start/server'
import { eq, inArray, like } from 'drizzle-orm'

import { SESSION_COOKIE_NAME } from '../config/auth.config'
import { CROWDSEC_SETTINGS_KEY } from '../config/crowdsec.config'
import { SYSTEM_ROLES } from '../config/permissions.config'
import { auditEvents, roles, systemSettings, userRoles, users } from '../db/schema'
import {
    getCrowdSecConfigurationService,
    reconcileCrowdSecConfiguration,
    testCrowdSecConnectionService,
    updateCrowdSecConfigurationService,
} from '../server/Admin/CrowdSec/crowdsec.service'
import { ensureAuthorizationRegistryInTransaction } from '../server/Auth/Access/registry.service'
import { createSessionService } from '../server/Auth/Access/sessions.service'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import { getDatabaseUrl } from '../server/env.server'

const enabled = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = enabled ? test : test.skip
const EMAIL_SUFFIX = '@crowdsec-test.invalid'
const CONTROLLER_TOKEN = 'crowdsec-controller-token-0000000000000000'
const APP_KEY = Buffer.from(new Uint8Array(32).fill(31)).toString('base64')
const EXTERNAL_KEY = 'external-bouncer-key-value'

const originalEnvironment = new Map(
    ['APP_ENCRYPTION_KEY', 'RENTNERPROXY_CONTROLLER_URL', 'RENTNERPROXY_CONTROLLER_TOKEN'].map(
        (key) => [key, process.env[key]] as const,
    ),
)

type RuntimeStatus = Readonly<{
    mode: 'disabled' | 'managed' | 'external'
    state: 'disabled' | 'connected' | 'degraded'
    apiUrl?: string
    credentialConfigured: boolean
    enforcementActive: boolean
    managedEngine: 'stopped' | 'ready'
    communityEnabled: boolean
    communityState: 'disabled' | 'connected'
    consoleState: 'not_enrolled'
    failureBehavior: 'fail_open'
    clientIpSource: 'caddy'
}>

function disabledRuntime(): RuntimeStatus {
    return {
        mode: 'disabled',
        state: 'disabled',
        credentialConfigured: false,
        enforcementActive: false,
        managedEngine: 'stopped',
        communityEnabled: false,
        communityState: 'disabled',
        consoleState: 'not_enrolled',
        failureBehavior: 'fail_open',
        clientIpSource: 'caddy',
    }
}

function fakeController() {
    let runtime = disabledRuntime()
    const applied: unknown[] = []
    const tested: unknown[] = []
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
            if (request.headers.get('authorization') !== `Bearer ${CONTROLLER_TOKEN}`) {
                return Response.json({ error: 'unauthorized' }, { status: 401 })
            }
            const path = new URL(request.url).pathname
            if (path === '/internal/v1/crowdsec/status' && request.method === 'GET') {
                return Response.json(runtime)
            }
            if (path === '/internal/v1/crowdsec/test' && request.method === 'POST') {
                const body = await request.json()
                tested.push(body)
                const candidate = body as { apiUrl?: string; apiKey?: string }
                return candidate.apiUrl?.includes('rejected') ||
                    candidate.apiKey === 'rejected-key-value'
                    ? Response.json({ error: 'crowdsec_connection_failed' }, { status: 422 })
                    : Response.json({ status: 'connected' })
            }
            if (path === '/internal/v1/crowdsec/config' && request.method === 'PUT') {
                const body = (await request.json()) as {
                    mode: 'disabled' | 'managed' | 'external'
                    communityEnabled?: boolean
                    apiUrl?: string
                    apiKey?: string
                }
                applied.push(body)
                runtime =
                    body.mode === 'disabled'
                        ? disabledRuntime()
                        : body.mode === 'managed'
                          ? {
                                mode: 'managed',
                                state: 'connected',
                                credentialConfigured: false,
                                enforcementActive: true,
                                managedEngine: 'ready',
                                communityEnabled: body.communityEnabled ?? false,
                                communityState: body.communityEnabled ? 'connected' : 'disabled',
                                consoleState: 'not_enrolled',
                                failureBehavior: 'fail_open',
                                clientIpSource: 'caddy',
                            }
                          : {
                                mode: 'external',
                                state: 'connected',
                                apiUrl: body.apiUrl!,
                                credentialConfigured: true,
                                enforcementActive: true,
                                managedEngine: 'stopped',
                                communityEnabled: false,
                                communityState: 'disabled',
                                consoleState: 'not_enrolled',
                                failureBehavior: 'fail_open',
                                clientIpSource: 'caddy',
                            }
                return Response.json(runtime)
            }
            return new Response(null, { status: 404 })
        },
    })
    process.env.RENTNERPROXY_CONTROLLER_URL = `http://127.0.0.1:${server.port}`
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = CONTROLLER_TOKEN
    return {
        applied,
        server,
        tested,
        resetRuntime: () => {
            runtime = disabledRuntime()
        },
    }
}

let controller: ReturnType<typeof fakeController> | undefined
let dedicatedDatabaseVerified = false

async function cleanup(): Promise<void> {
    const database = getAuthDatabase()
    const testUsers = await database
        .select({ id: users.id })
        .from(users)
        .where(like(users.email, `%${EMAIL_SUFFIX}`))
    if (testUsers.length > 0) {
        await database.delete(auditEvents).where(
            inArray(
                auditEvents.actorUserId,
                testUsers.map(({ id }) => id),
            ),
        )
    }
    await database.delete(users).where(like(users.email, `%${EMAIL_SUFFIX}`))
    await database.delete(systemSettings).where(eq(systemSettings.key, CROWDSEC_SETTINGS_KEY))
}

async function createUser(roleKey: string): Promise<string> {
    return getAuthDatabase().transaction(async (transaction) => {
        const [user] = await transaction
            .insert(users)
            .values({
                displayName: 'CrowdSec test',
                email: `${randomUUID()}${EMAIL_SUFFIX}`,
                status: 'active',
                emailVerifiedAt: new Date(),
            })
            .returning({ id: users.id })
        const [role] = await transaction
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, roleKey))
            .limit(1)
        if (!user || !role) throw new Error('CrowdSec integration test identity unavailable.')
        await transaction.insert(userRoles).values({ userId: user.id, roleId: role.id })
        return user.id
    })
}

async function asUser<T>(userId: string, action: () => Promise<T>): Promise<T> {
    const session = await createSessionService(userId)
    let result: T | undefined
    let failure: unknown
    const handler = requestHandler(async () => {
        try {
            result = await action()
        } catch (error) {
            failure = error
        }
        return new Response(null)
    })
    await handler(
        new Request('http://localhost/', {
            headers: { cookie: `${SESSION_COOKIE_NAME}=${session.token}` },
        }),
        {},
    )
    if (failure) throw failure
    return result as T
}

beforeAll(async () => {
    if (!enabled) return
    if (new URL(getDatabaseUrl()!).pathname !== '/rentnerproxy_upstream_test') {
        throw new Error('CrowdSec integration requires its disposable test database.')
    }
    dedicatedDatabaseVerified = true
    process.env.APP_ENCRYPTION_KEY = APP_KEY
    await getAuthDatabase().transaction(ensureAuthorizationRegistryInTransaction)
    await cleanup()
})

beforeEach(async () => {
    if (!enabled) return
    await cleanup()
    process.env.APP_ENCRYPTION_KEY = APP_KEY
    controller = fakeController()
})

afterEach(async () => {
    controller?.server.stop(true)
    controller = undefined
    for (const [key, value] of originalEnvironment) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    if (enabled && dedicatedDatabaseVerified) await cleanup()
})

afterAll(async () => {
    await reconcileCrowdSecConfiguration.stop()
})

describe('CrowdSec configuration with PostgreSQL', () => {
    integrationTest('defaults an Alpha 6 upgrade to disabled and enforces RBAC', async () => {
        const viewer = await createUser(SYSTEM_ROLES.VIEWER)
        expect(await asUser(viewer, getCrowdSecConfigurationService)).toMatchObject({
            mode: 'disabled',
            hasApiKey: false,
            synchronized: true,
        })

        await expect(
            asUser(viewer, () => updateCrowdSecConfigurationService({ mode: 'managed' })),
        ).rejects.toMatchObject({ code: 'permission_denied' })
        expect(controller?.applied).toHaveLength(0)
    })

    integrationTest('persists community opt-in only within managed mode', async () => {
        const owner = await createUser(SYSTEM_ROLES.OWNER)
        const enabledResult = await asUser(owner, () =>
            updateCrowdSecConfigurationService({ mode: 'managed', communityEnabled: true }),
        )
        expect(enabledResult.runtimeStatus).toBe('applied')
        expect(await asUser(owner, getCrowdSecConfigurationService)).toMatchObject({
            mode: 'managed',
            communityEnabled: true,
            synchronized: true,
        })
        expect(controller?.applied[0]).toEqual({ mode: 'managed', communityEnabled: true })

        const disabledResult = await asUser(owner, () =>
            updateCrowdSecConfigurationService({ mode: 'managed', communityEnabled: false }),
        )
        expect(disabledResult.runtimeStatus).toBe('applied')
        expect(controller?.applied[1]).toEqual({ mode: 'managed', communityEnabled: false })
    })

    integrationTest('encrypts, audits, applies, and retains an external provider', async () => {
        const owner = await createUser(SYSTEM_ROLES.OWNER)
        const result = await asUser(owner, () =>
            updateCrowdSecConfigurationService({
                mode: 'external',
                apiUrl: 'https://crowdsec.example.test:8080',
                apiKey: EXTERNAL_KEY,
            }),
        )
        expect(result.runtimeStatus).toBe('applied')
        expect(controller?.tested).toEqual([
            {
                mode: 'external',
                apiUrl: 'https://crowdsec.example.test:8080/',
                apiKey: EXTERNAL_KEY,
            },
        ])
        expect(controller?.applied).toEqual([
            {
                mode: 'external',
                apiUrl: 'https://crowdsec.example.test:8080/',
                apiKey: EXTERNAL_KEY,
            },
        ])

        const [setting] = await getAuthDatabase()
            .select({ value: systemSettings.value })
            .from(systemSettings)
            .where(eq(systemSettings.key, CROWDSEC_SETTINGS_KEY))
        expect(setting).toBeDefined()
        expect(JSON.stringify(setting?.value)).not.toContain(EXTERNAL_KEY)
        expect(await asUser(owner, getCrowdSecConfigurationService)).toMatchObject({
            mode: 'external',
            externalApiUrl: 'https://crowdsec.example.test:8080/',
            hasApiKey: true,
            synchronized: true,
        })
        const events = await getAuthDatabase()
            .select({ action: auditEvents.action, resource: auditEvents.resource })
            .from(auditEvents)
            .where(eq(auditEvents.actorUserId, owner))
        expect(events).toContainEqual({ action: 'update', resource: 'crowdsec' })
        expect(events).not.toContainEqual({ action: 'rotate', resource: 'crowdsec' })

        await asUser(owner, () => updateCrowdSecConfigurationService({ mode: 'disabled' }))
        const restored = await asUser(owner, () =>
            updateCrowdSecConfigurationService({
                mode: 'external',
                apiUrl: 'https://crowdsec.example.test:8080/',
            }),
        )
        expect(restored.runtimeStatus).toBe('applied')
        expect(controller?.applied.at(-1)).toMatchObject({ apiKey: EXTERNAL_KEY })

        const replacementKey = 'replacement-bouncer-key-value'
        await asUser(owner, () =>
            updateCrowdSecConfigurationService({
                mode: 'external',
                apiUrl: 'https://crowdsec.example.test:8080/',
                apiKey: replacementKey,
            }),
        )
        const rotationEvents = await getAuthDatabase()
            .select({
                action: auditEvents.action,
                resource: auditEvents.resource,
                metadata: auditEvents.metadata,
            })
            .from(auditEvents)
            .where(eq(auditEvents.actorUserId, owner))
        expect(rotationEvents.filter((event) => event.action === 'rotate')).toEqual([
            { action: 'rotate', resource: 'crowdsec', metadata: {} },
        ])
        expect(JSON.stringify(rotationEvents)).not.toContain(replacementKey)
        expect(controller?.applied.at(-1)).toMatchObject({ apiKey: replacementKey })
    })

    integrationTest(
        'rejects an invalid target before persistence or runtime switching',
        async () => {
            const owner = await createUser(SYSTEM_ROLES.OWNER)
            await asUser(owner, () => updateCrowdSecConfigurationService({ mode: 'managed' }))

            await expect(
                asUser(owner, () =>
                    updateCrowdSecConfigurationService({
                        mode: 'external',
                        apiUrl: 'https://rejected.example.test/',
                        apiKey: EXTERNAL_KEY,
                    }),
                ),
            ).rejects.toMatchObject({ code: 'connection_failed' })

            expect(await asUser(owner, getCrowdSecConfigurationService)).toMatchObject({
                mode: 'managed',
                synchronized: true,
            })
            expect(controller?.applied).toHaveLength(1)
            expect(controller?.applied[0]).toEqual({ mode: 'managed', communityEnabled: false })
        },
    )

    integrationTest('rehydrates encrypted desired state after a controller restart', async () => {
        const owner = await createUser(SYSTEM_ROLES.OWNER)
        await asUser(owner, () =>
            updateCrowdSecConfigurationService({
                mode: 'external',
                apiUrl: 'https://crowdsec.example.test/',
                apiKey: EXTERNAL_KEY,
            }),
        )
        controller?.resetRuntime()

        expect(await reconcileCrowdSecConfiguration()).toBe('applied')
        expect(controller?.applied.at(-1)).toEqual({
            mode: 'external',
            apiUrl: 'https://crowdsec.example.test/',
            apiKey: EXTERNAL_KEY,
        })
    })

    integrationTest('never reuses the stored key when testing a different endpoint', async () => {
        const owner = await createUser(SYSTEM_ROLES.OWNER)
        await asUser(owner, () =>
            updateCrowdSecConfigurationService({
                mode: 'external',
                apiUrl: 'https://crowdsec.example.test/',
                apiKey: EXTERNAL_KEY,
            }),
        )
        await asUser(owner, () =>
            testCrowdSecConnectionService({ apiUrl: 'https://crowdsec.example.test/' }),
        )
        expect(controller?.tested.at(-1)).toMatchObject({ apiKey: EXTERNAL_KEY })
        await expect(
            asUser(owner, () =>
                testCrowdSecConnectionService({ apiUrl: 'https://other.example.test/' }),
            ),
        ).rejects.toMatchObject({ code: 'api_key_required' })
        expect(controller?.tested).toHaveLength(2)
    })
})

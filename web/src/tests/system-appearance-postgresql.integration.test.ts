import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { requestHandler } from '@tanstack/react-start/server'
import { eq, inArray, like } from 'drizzle-orm'

import { SESSION_COOKIE_NAME } from '../config/auth.config'
import { systemAccentColorUpdateSchema } from '../config/appearance.config'
import { SYSTEM_ROLES } from '../config/permissions.config'
import { auditEvents, roles, systemSettings, userRoles, users } from '../db/schema'
import { getDatabaseUrl } from '../server/env.server'
import { DEFAULT_ACCENT_COLOR } from '../config/appearance.config'

const enabled = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = enabled ? test : test.skip
const EMAIL_SUFFIX = '@system-appearance-test.invalid'
let disposableDatabaseVerified = false
type AuthDatabaseModule = typeof import('../server/Auth/Core/database.server')
type SessionServiceModule = typeof import('../server/Auth/Access/sessions.service')
type AppearanceServiceModule = typeof import('../server/SystemAppearance/system-appearance.service')
type RegistryServiceModule = typeof import('../server/Auth/Access/registry.service')
let databaseModule: AuthDatabaseModule | undefined
let sessionModule: SessionServiceModule | undefined
let appearanceService: AppearanceServiceModule | undefined
let registryService: RegistryServiceModule | undefined

function getAuthDatabase() {
    if (!databaseModule) throw new Error('System appearance integration database is unavailable.')
    return databaseModule.getAuthDatabase()
}

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
    const settingsKey = appearanceService?.SYSTEM_APPEARANCE_SETTINGS_KEY
    if (settingsKey) {
        await database.delete(systemSettings).where(eq(systemSettings.key, settingsKey))
    }
}

async function createUser(roleKey: string): Promise<string> {
    return getAuthDatabase().transaction(async (transaction) => {
        const [user] = await transaction
            .insert(users)
            .values({
                displayName: 'System appearance test',
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
        if (!user || !role) throw new Error('System appearance test identity unavailable.')
        await transaction.insert(userRoles).values({ userId: user.id, roleId: role.id })
        return user.id
    })
}

async function asUser<T>(userId: string, action: () => Promise<T>): Promise<T> {
    if (!sessionModule)
        throw new Error('System appearance integration session service is unavailable.')
    const session = await sessionModule.createSessionService(userId)
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
        throw new Error('System appearance integration requires its disposable test database.')
    }
    disposableDatabaseVerified = true
    ;[databaseModule, sessionModule, appearanceService, registryService] = await Promise.all([
        import('../server/Auth/Core/database.server'),
        import('../server/Auth/Access/sessions.service'),
        import('../server/SystemAppearance/system-appearance.service'),
        import('../server/Auth/Access/registry.service'),
    ])
    await getAuthDatabase().transaction(registryService.ensureAuthorizationRegistryInTransaction)
    await cleanup()
})

afterEach(async () => {
    if (enabled && disposableDatabaseVerified) await cleanup()
})

afterAll(async () => {
    if (enabled && disposableDatabaseVerified) await cleanup()
})

describe('system appearance with PostgreSQL', () => {
    integrationTest(
        'persists normalized accents, resets to default, and enforces RBAC',
        async () => {
            if (!appearanceService) throw new Error('System appearance service is unavailable.')
            const admin = await createUser(SYSTEM_ROLES.ADMIN)
            const viewer = await createUser(SYSTEM_ROLES.VIEWER)

            expect(await appearanceService.getSystemAccentColorService()).toBe(DEFAULT_ACCENT_COLOR)

            await expect(
                asUser(viewer, () =>
                    appearanceService!.updateSystemAccentColorService({ accentColor: '#af12ce' }),
                ),
            ).rejects.toMatchObject({ code: 'permission_denied' })
            expect(await appearanceService.getSystemAccentColorService()).toBe(DEFAULT_ACCENT_COLOR)

            expect(
                await asUser(admin, () =>
                    appearanceService!.updateSystemAccentColorService(
                        systemAccentColorUpdateSchema.parse({ accentColor: '#A0b1C2' }),
                    ),
                ),
            ).toBe('#a0b1c2')
            expect(await appearanceService.getSystemAccentColorService()).toBe('#a0b1c2')

            const [saved] = await getAuthDatabase()
                .select({ value: systemSettings.value })
                .from(systemSettings)
                .where(eq(systemSettings.key, appearanceService.SYSTEM_APPEARANCE_SETTINGS_KEY))
                .limit(1)
            expect(saved?.value).toEqual({ version: 1, accentColor: '#a0b1c2' })

            expect(
                await asUser(admin, () =>
                    appearanceService!.updateSystemAccentColorService({ accentColor: null }),
                ),
            ).toBe(DEFAULT_ACCENT_COLOR)
            expect(await appearanceService.getSystemAccentColorService()).toBe(DEFAULT_ACCENT_COLOR)
        },
    )
})

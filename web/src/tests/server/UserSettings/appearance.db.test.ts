import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { requestHandler } from '@tanstack/react-start/server'
import { eq, inArray, like } from 'drizzle-orm'

import { SESSION_COOKIE_NAME } from '@/config/auth.config.ts'
import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import { SYSTEM_ROLES } from '@/config/permissions.config.ts'
import { auditEvents, roles, systemSettings, userRoles, users } from '@/db/schema.ts'
import {
    userAccentColorUpdateSchema,
    userAppearanceSettingsKey,
} from '@/lib/UserSettings/appearance.ts'
import { getDatabaseUrl } from '@/server/env.server.ts'

const enabled = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = enabled ? test : test.skip
const EMAIL_SUFFIX = '@user-appearance-test.invalid'
let disposableDatabaseVerified = false
type AuthDatabaseModule = typeof import('@/server/Auth/Core/database.server.ts')
type SessionServiceModule = typeof import('@/server/Auth/Access/sessions.service.ts')
type AppearanceServiceModule = typeof import('@/server/UserSettings/appearance.service.ts')
type RegistryServiceModule = typeof import('@/server/Auth/Access/registry.service.ts')
type AccessServiceModule = typeof import('@/server/Auth/Access/rbac.service.ts')
let databaseModule: AuthDatabaseModule | undefined
let sessionModule: SessionServiceModule | undefined
let appearanceService: AppearanceServiceModule | undefined
let registryService: RegistryServiceModule | undefined
let accessService: AccessServiceModule | undefined

function getAuthDatabase() {
    if (!databaseModule) throw new Error('User appearance integration database is unavailable.')
    return databaseModule.getAuthDatabase()
}

async function cleanup(): Promise<void> {
    const database = getAuthDatabase()
    const testUsers = await database
        .select({ id: users.id })
        .from(users)
        .where(like(users.email, `%${EMAIL_SUFFIX}`))
    if (testUsers.length === 0) return
    const userIds = testUsers.map(({ id }) => id)
    await database.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds))
    await database
        .delete(systemSettings)
        .where(inArray(systemSettings.key, userIds.map(userAppearanceSettingsKey)))
    await database.delete(users).where(inArray(users.id, userIds))
}

async function createUser(roleKey: string): Promise<string> {
    return getAuthDatabase().transaction(async (transaction) => {
        const [user] = await transaction
            .insert(users)
            .values({
                displayName: 'User appearance test',
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
        if (!user || !role) throw new Error('User appearance test identity unavailable.')
        await transaction.insert(userRoles).values({ userId: user.id, roleId: role.id })
        return user.id
    })
}

async function inRequest<T>(action: () => Promise<T>, token?: string): Promise<T> {
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
        new Request('http://localhost/account', {
            headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
        }),
        {},
    )
    if (failure) throw failure
    return result as T
}

async function asUser<T>(userId: string, action: () => Promise<T>): Promise<T> {
    if (!sessionModule)
        throw new Error('User appearance integration session service is unavailable.')
    const session = await sessionModule.createSessionService(userId)
    return inRequest(action, session.token)
}

async function accentForUser(userId: string): Promise<string | undefined> {
    if (!accessService)
        throw new Error('User appearance integration access service is unavailable.')
    const service = accessService
    const user = await getAuthDatabase().transaction((transaction) =>
        service.resolveActiveUserAccessInTransaction(transaction, userId),
    )
    return user?.accentColor
}

beforeAll(async () => {
    if (!enabled) return
    if (new URL(getDatabaseUrl()!).pathname !== '/rentnerproxy_upstream_test') {
        throw new Error('User appearance integration requires its disposable test database.')
    }
    disposableDatabaseVerified = true
    ;[databaseModule, sessionModule, appearanceService, registryService, accessService] =
        await Promise.all([
            import('@/server/Auth/Core/database.server.ts'),
            import('@/server/Auth/Access/sessions.service.ts'),
            import('@/server/UserSettings/appearance.service.ts'),
            import('@/server/Auth/Access/registry.service.ts'),
            import('@/server/Auth/Access/rbac.service.ts'),
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

describe('user appearance with PostgreSQL', () => {
    integrationTest(
        'persists independent accents for regular users and resets only the current account',
        async () => {
            if (!appearanceService) throw new Error('User appearance service is unavailable.')
            const service = appearanceService
            const first = await createUser(SYSTEM_ROLES.VIEWER)
            const second = await createUser(SYSTEM_ROLES.VIEWER)
            expect(await accentForUser(first)).toBe(DEFAULT_ACCENT_COLOR)
            expect(await accentForUser(second)).toBe(DEFAULT_ACCENT_COLOR)

            await asUser(first, () =>
                service.updateCurrentUserAccentColorService(
                    userAccentColorUpdateSchema.parse({
                        expectedUserId: first,
                        accentColor: '#A0b1C2',
                    }),
                ),
            )
            expect(await accentForUser(first)).toBe('#a0b1c2')
            expect(await accentForUser(second)).toBe(DEFAULT_ACCENT_COLOR)

            await asUser(second, () =>
                service.updateCurrentUserAccentColorService({
                    expectedUserId: second,
                    accentColor: '#abcdef',
                }),
            )
            await expect(
                asUser(first, () =>
                    service.updateCurrentUserAccentColorService({
                        expectedUserId: second,
                        accentColor: '#ff0000',
                    }),
                ),
            ).rejects.toMatchObject({ code: 'authentication_required' })
            await expect(
                inRequest(() =>
                    service.updateCurrentUserAccentColorService({
                        expectedUserId: first,
                        accentColor: '#ff0000',
                    }),
                ),
            ).rejects.toMatchObject({ code: 'authentication_required' })
            expect(await accentForUser(first)).toBe('#a0b1c2')
            expect(await accentForUser(second)).toBe('#abcdef')

            await asUser(first, () =>
                service.updateCurrentUserAccentColorService({
                    expectedUserId: first,
                    accentColor: null,
                }),
            )
            expect(await accentForUser(first)).toBe(DEFAULT_ACCENT_COLOR)
            expect(await accentForUser(second)).toBe('#abcdef')

            const saved = await getAuthDatabase()
                .select({ key: systemSettings.key, value: systemSettings.value })
                .from(systemSettings)
                .where(
                    inArray(systemSettings.key, [
                        userAppearanceSettingsKey(first),
                        userAppearanceSettingsKey(second),
                    ]),
                )
            expect(new Map(saved.map(({ key, value }) => [key, value]))).toEqual(
                new Map([
                    [
                        userAppearanceSettingsKey(first),
                        { version: 1, accentColor: DEFAULT_ACCENT_COLOR },
                    ],
                    [userAppearanceSettingsKey(second), { version: 1, accentColor: '#abcdef' }],
                ]),
            )
        },
    )
})

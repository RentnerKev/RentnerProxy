import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

import {
    DEFAULT_ACCENT_COLOR,
    parseStoredSystemAppearance,
    storedSystemAppearanceSchema,
    systemAccentColorUpdateSchema,
} from '../config/appearance.config'
import {
    PERMISSIONS,
    PERMISSION_REGISTRY,
    SYSTEM_ROLE_REGISTRY,
    SYSTEM_ROLES,
} from '../config/permissions.config'

describe('system appearance validation', () => {
    test('normalizes six-digit hex colors and accepts null to reset', () => {
        expect(systemAccentColorUpdateSchema.parse({ accentColor: '#Ab12Ef' })).toEqual({
            accentColor: '#ab12ef',
        })
        expect(systemAccentColorUpdateSchema.parse({ accentColor: null })).toEqual({
            accentColor: null,
        })
    })

    test('rejects malformed colors and unexpected settings', () => {
        for (const accentColor of ['green', '#12ab', '#12345678', ' #123456', '#gg0000']) {
            expect(systemAccentColorUpdateSchema.safeParse({ accentColor }).success).toBeFalse()
        }
        expect(
            systemAccentColorUpdateSchema.safeParse({ accentColor: '#123456', mode: 'dark' })
                .success,
        ).toBeFalse()
    })

    test('requires persisted values to match the strict versioned schema', () => {
        expect(parseStoredSystemAppearance({ version: 1, accentColor: '#AABBCC' })).toBe('#aabbcc')
        expect(parseStoredSystemAppearance({ version: 2, accentColor: '#aabbcc' })).toBeNull()
        expect(
            parseStoredSystemAppearance({ version: 1, accentColor: '#aabbcc', mode: 'dark' }),
        ).toBeNull()
        expect(DEFAULT_ACCENT_COLOR).toBe('#30ee61')
        expect(
            storedSystemAppearanceSchema.safeParse({ version: 1, accentColor: '#abcdef' }).success,
        ).toBeTrue()
    })

    test('registers the mutation permission for owners and admins only by default', () => {
        expect(
            PERMISSION_REGISTRY.filter(({ key }) => key === PERMISSIONS.SYSTEM_APPEARANCE_UPDATE),
        ).toHaveLength(1)
        const byRole = new Map(
            SYSTEM_ROLE_REGISTRY.map(({ key, permissionKeys }) => [key, permissionKeys]),
        )
        expect(byRole.get(SYSTEM_ROLES.OWNER)).toContain(PERMISSIONS.SYSTEM_APPEARANCE_UPDATE)
        expect(byRole.get(SYSTEM_ROLES.ADMIN)).toContain(PERMISSIONS.SYSTEM_APPEARANCE_UPDATE)
        expect(byRole.get(SYSTEM_ROLES.VIEWER)).not.toContain(PERMISSIONS.SYSTEM_APPEARANCE_UPDATE)
    })
})

test('system appearance mutation checks permission before opening the database', async () => {
    const script = `
        import { mock } from 'bun:test'
        let allowed = false
        let permissionChecks = []
        let databaseCalls = 0
        let persisted
        mock.module('./server/Auth/Access/authorization.service.ts', () => ({
            requirePermissionService: async (permission) => {
                permissionChecks.push(permission)
                if (!allowed) throw Object.assign(new Error('Denied'), { code: 'permission_denied' })
            },
        }))
        mock.module('./server/Auth/Core/database.server.ts', () => ({
            getAuthDatabase: () => ({
                insert: () => {
                    databaseCalls++
                    const query = {
                        values: (value) => { persisted = value; return query },
                        onConflictDoUpdate: () => query,
                        returning: async () => [{ value: { version: 1, accentColor: '#abcdef' } }],
                    }
                    return query
                },
            }),
        }))
        const { updateSystemAccentColorService } = await import('./server/SystemAppearance/system-appearance.service.ts')
        const denied = await updateSystemAccentColorService({ accentColor: '#abcdef' }).then(
            () => false, (error) => error.code === 'permission_denied',
        )
        const deniedDatabaseCalls = databaseCalls
        allowed = true
        const accentColor = await updateSystemAccentColorService({ accentColor: '#abcdef' })
        console.log(JSON.stringify({ denied, deniedDatabaseCalls, accentColor, databaseCalls, permissionChecks, key: persisted?.key }))
    `
    const child = Bun.spawn([process.execPath, '-e', script], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
        denied: true,
        deniedDatabaseCalls: 0,
        accentColor: '#abcdef',
        databaseCalls: 1,
        permissionChecks: [
            PERMISSIONS.SYSTEM_APPEARANCE_UPDATE,
            PERMISSIONS.SYSTEM_APPEARANCE_UPDATE,
        ],
        key: 'system_appearance_v1',
    })
})

test('system appearance API returns a structured invalid-color result before authorization', async () => {
    const script = `
        import { mock } from 'bun:test'
        let permissionChecks = 0
        let databaseCalls = 0
        mock.module('@tanstack/react-start', () => ({
            createServerFn: () => {
                const chain = {
                    validator: () => chain,
                    handler: (handler) => handler,
                }
                return chain
            },
        }))
        mock.module('@tanstack/react-start/server', () => ({ setResponseHeader() {} }))
        mock.module('./features/Auth/serverHelpers.ts', () => ({
            localizedActionFailure: () => ({ success: false, message: 'saveFailed' }),
            throwLocalizedQueryError: () => { throw new Error('unavailable') },
        }))
        mock.module('./server/SystemAppearance/system-appearance.service.ts', () => ({
            getSystemAccentColorService: async () => '#30ee61',
            updateSystemAccentColorService: async () => '#30ee61',
        }))
        mock.module('./server/Auth/Access/authorization.service.ts', () => ({
            requirePermissionService: async () => { permissionChecks++ },
        }))
        mock.module('./server/Auth/Core/database.server.ts', () => ({
            getAuthDatabase: () => {
                databaseCalls++
                throw new Error('The invalid request must not reach the database')
            },
        }))
        const { updateSystemAccentColorHandler } = await import('./features/SystemAppearance/server.ts')
        const result = await updateSystemAccentColorHandler({ data: { accentColor: 'lime' } })
        console.log(JSON.stringify({ result, permissionChecks, databaseCalls }))
    `
    const child = Bun.spawn([process.execPath, '-e', script], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
        result: { success: false, message: 'systemAppearance.errors.invalidColor' },
        permissionChecks: 0,
        databaseCalls: 0,
    })
})

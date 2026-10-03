import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'

test('personal accents remain independent and require the current account before writing', async () => {
    const script = `
        import { mock } from 'bun:test'
        import { PgDialect } from 'drizzle-orm/pg-core'
        const firstId = '6f355778-511f-467b-ad8f-8c4a29b84510'
        const secondId = '66b1c097-ddd5-4e1a-bd04-d9007e4010b9'
        let currentUser = null
        let databaseCalls = 0
        const permissionChecks = []
        const saved = new Map([['system_appearance_v1', {version: 1, accentColor: '#ff0000'}]])
        mock.module('./server/Auth/Access/authorization.service.ts', () => ({
            requirePermissionService: async (permission) => {
                permissionChecks.push(permission)
                if (!currentUser) throw Object.assign(new Error('Sign in'), {code: 'authentication_required'})
                if (!currentUser.permissions.includes(permission)) throw Object.assign(new Error('Denied'), {code: 'permission_denied'})
                return currentUser
            },
        }))
        mock.module('./server/Auth/Core/database.server.ts', () => ({
            getAuthDatabase: () => {
                databaseCalls++
                let row
                const query = {
                    values: (value) => {row = value; return query},
                    onConflictDoUpdate: () => query,
                    returning: async () => {
                        const value = new PgDialect().sqlToQuery(row.value).params[0]
                        saved.set(row.key, value)
                        return [{value}]
                    },
                }
                return {insert: () => query}
            },
        }))
        const { updateCurrentUserAccentColorService: update } = await import('./server/UserSettings/appearance.service.ts')
        const failure = (input) => update(input).then(() => 'unexpected_success', (error) => error.code)
        const anonymous = await failure({expectedUserId: firstId, accentColor: '#abcdef'})
        currentUser = {id: firstId, permissions: []}
        const denied = await failure({expectedUserId: firstId, accentColor: '#abcdef'})
        currentUser.permissions = ['app.access']
        const wrongAccount = await failure({expectedUserId: secondId, accentColor: '#abcdef'})
        const deniedDatabaseCalls = databaseCalls
        const first = await update({expectedUserId: firstId, accentColor: '#abcdef'})
        currentUser = {id: secondId, permissions: ['app.access']}
        const second = await update({expectedUserId: secondId, accentColor: '#123456'})
        currentUser = {id: firstId, permissions: ['app.access']}
        const reset = await update({expectedUserId: firstId, accentColor: null})
        console.log(JSON.stringify({anonymous, denied, wrongAccount, deniedDatabaseCalls, first, second, reset, saved: [...saved], permissionChecks}))
    `
    const child = Bun.spawn([process.execPath, '--no-env-file', '-e', script], {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    expect(exitCode, stderr).toBe(0)
    const firstId = '6f355778-511f-467b-ad8f-8c4a29b84510'
    const secondId = '66b1c097-ddd5-4e1a-bd04-d9007e4010b9'
    expect(JSON.parse(stdout)).toEqual({
        anonymous: 'authentication_required',
        denied: 'permission_denied',
        wrongAccount: 'authentication_required',
        deniedDatabaseCalls: 0,
        first: { userId: firstId, accentColor: '#abcdef' },
        second: { userId: secondId, accentColor: '#123456' },
        reset: { userId: firstId, accentColor: DEFAULT_ACCENT_COLOR },
        saved: [
            ['system_appearance_v1', { version: 1, accentColor: '#ff0000' }],
            [`user_appearance_v1:${firstId}`, { version: 1, accentColor: DEFAULT_ACCENT_COLOR }],
            [`user_appearance_v1:${secondId}`, { version: 1, accentColor: '#123456' }],
        ],
        permissionChecks: Array.from({ length: 6 }, () => PERMISSIONS.APP_ACCESS),
    })
})

test('the personal appearance API validates the account and color and returns uncached structured results', async () => {
    const script = `
        import { mock } from 'bun:test'
        const calls = []
        const headers = []
        mock.module('@tanstack/react-start', () => ({
            createServerOnlyFn: (handler) => handler,
            createServerFn: () => {
                const chain = {validator: () => chain, handler: (handler) => handler}
                return chain
            },
        }))
        const originalServer = await import('@tanstack/react-start/server')
        mock.module('@tanstack/react-start/server', () => ({...originalServer, setResponseHeader: (...args) => headers.push(args)}))
        mock.module('./server/Auth/Core/database.server.ts', () => ({
            getAuthDatabase: () => { throw new Error('The API test must not access a database') },
        }))
        mock.module('./server/UserSettings/appearance.service.ts', () => ({
            updateCurrentUserAccentColorService: async (input) => {
                calls.push(input)
                return {userId: input.expectedUserId, accentColor: input.accentColor}
            },
        }))
        const { updateCurrentUserAccentColorHandler: update } = await import('./features/UserSettings/middleware.ts')
        const expectedUserId = '6f355778-511f-467b-ad8f-8c4a29b84510'
        const invalidColor = await update({data: {expectedUserId, accentColor: 'lime'}})
        const invalidAccount = await update({data: {expectedUserId, accentColor: '#abcdef', userId: 'forged'}})
        const result = await update({data: {expectedUserId, accentColor: '#Ab12Ef'}})
        console.log(JSON.stringify({invalidColor, invalidAccount, result, calls, headers}))
    `
    const child = Bun.spawn([process.execPath, '--no-env-file', '-e', script], {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    expect(exitCode, stderr).toBe(0)
    const userId = '6f355778-511f-467b-ad8f-8c4a29b84510'
    expect(JSON.parse(stdout)).toEqual({
        invalidColor: { success: false, message: 'userAppearance.errors.invalidColor' },
        invalidAccount: { success: false, message: 'userAppearance.errors.invalidColor' },
        result: { success: true, userId, accentColor: '#ab12ef' },
        calls: [{ expectedUserId: userId, accentColor: '#ab12ef' }],
        headers: Array.from({ length: 3 }, () => ['Cache-Control', 'no-store']),
    })
})

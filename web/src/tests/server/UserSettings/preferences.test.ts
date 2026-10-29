import { expect, test } from 'bun:test'

import { runBunScript } from '@/tests/Helpers/runBunScript.ts'

test.each([
    ['language', 'updateCurrentUserLanguageService', 'de'],
    ['themeMode', 'updateCurrentUserThemeModeService', 'dark'],
] as const)(
    '%s updates only the signed-in user and keeps permission and persistence failures',
    async (key, method, value) => {
        const script = `
        import { mock } from 'bun:test'
        let session = null
        let rows = [{}]
        let calls = 0
        let changes = 0
        const writes = []
        mock.module('./server/WebSockets/applicationChanges.ts', () => ({
            publishApplicationChange: () => { changes++ },
        }))
        mock.module('./server/Auth/Access/sessions.service.ts', () => ({
            getCurrentSessionService: async () => session,
        }))
        mock.module('./server/Auth/Core/database.server.ts', () => ({
            getAuthDatabase: () => {
                calls++
                const query = {
                    values: (value) => { writes.push(value); return query },
                    onConflictDoUpdate: (value) => { writes.push(value.set); return query },
                    returning: async () => rows,
                }
                return { insert: () => query }
            },
        }))
        const service = (await import('./server/UserSettings/preferences.service.ts'))[${JSON.stringify(method)}]
        const attempt = () => service(${JSON.stringify(value)}).catch((error) => error.code)
        const anonymous = await attempt()
        session = {user: {id: 'current-user', permissions: []}}
        const denied = await attempt()
        const deniedCalls = calls
        session.user.permissions = ['app.access']
        const saved = await attempt()
        rows = []
        const unavailable = await attempt()
        session.user[${JSON.stringify(key)}] = ${JSON.stringify(value)}
        const unchanged = await attempt()
        console.log(JSON.stringify({anonymous, denied, deniedCalls, saved, unavailable, unchanged, changes, writes}))
    `
        const stdout = await runBunScript(script, { cwd: new URL('../../..', import.meta.url) })
        const preference = { [key]: value }
        expect(JSON.parse(stdout)).toEqual({
            anonymous: 'authentication_required',
            denied: 'permission_denied',
            deniedCalls: 0,
            saved: value,
            unavailable: 'service_unavailable',
            unchanged: value,
            changes: 1,
            writes: [
                { userId: 'current-user', ...preference },
                preference,
                { userId: 'current-user', ...preference },
                preference,
            ],
        })
    },
)

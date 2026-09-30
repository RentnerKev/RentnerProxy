import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

import {
    NAVIGATION_GROUP_IDS,
    navigationGroupPreferenceInputSchema,
    parseStoredNavigationGroupPreferences,
} from '../config/navigation.config'

const expectedUserId = '11111111-1111-4111-8111-111111111111'

describe('navigation preference validation', () => {
    test('accepts stable group IDs and explicit booleans', () => {
        for (const groupId of NAVIGATION_GROUP_IDS) {
            for (const expanded of [true, false]) {
                expect(
                    navigationGroupPreferenceInputSchema.parse({
                        expectedUserId,
                        groupId,
                        expanded,
                    }),
                ).toEqual({ expectedUserId, groupId, expanded })
            }
        }
    })

    test('rejects translated or unknown IDs, non-booleans, and unexpected input', () => {
        const valid = { expectedUserId, groupId: 'security', expanded: true }
        for (const groupId of ['Security', 'Sicherheit', 'removed-group', '__proto__']) {
            expect(
                navigationGroupPreferenceInputSchema.safeParse({ ...valid, groupId }).success,
            ).toBeFalse()
        }
        for (const expanded of ['true', 1, null, undefined]) {
            expect(
                navigationGroupPreferenceInputSchema.safeParse({ ...valid, expanded }).success,
            ).toBeFalse()
        }
        expect(
            navigationGroupPreferenceInputSchema.safeParse({ ...valid, userId: expectedUserId })
                .success,
        ).toBeFalse()
        expect(
            navigationGroupPreferenceInputSchema.safeParse({
                ...valid,
                expectedUserId: 'other-user',
            }).success,
        ).toBeFalse()
    })

    test('keeps valid known values while safely ignoring stale and malformed stored data', () => {
        expect(
            parseStoredNavigationGroupPreferences({
                operations: false,
                security: true,
                administration: 'true',
                records: null,
                retired: true,
            }),
        ).toEqual({ operations: false, security: true })
        for (const value of [undefined, null, [], 'security', 42, true]) {
            expect(parseStoredNavigationGroupPreferences(value)).toEqual({})
        }
        expect(parseStoredNavigationGroupPreferences(Object.create({ security: true }))).toEqual({})
    })
})

test('navigation persistence requires application access and the same signed-in user before writing', async () => {
    const script = `
        import { mock } from 'bun:test'
        let principal = null
        let databaseCalls = 0
        let persisted
        mock.module('./server/Auth/Access/authorization.service.ts', () => ({
            requirePermissionService: async () => {
                if (!principal) throw Object.assign(new Error('No session'), { code: 'authentication_required' })
                if (!principal.allowed) throw Object.assign(new Error('Denied'), { code: 'permission_denied' })
                return principal
            },
        }))
        mock.module('./server/Auth/Core/database.server.ts', () => ({
            getAuthDatabase: () => {
                databaseCalls++
                return {
                    insert: () => {
                        const query = {
                            values: (value) => { persisted = value; return query },
                            onConflictDoUpdate: () => query,
                            returning: async () => [{ userId: principal.id }],
                        }
                        return query
                    },
                }
            },
        }))
        const { updateCurrentUserNavigationGroupService: save } = await import('./server/UserSettings/navigation.service.ts')
        const input = { expectedUserId: '11111111-1111-4111-8111-111111111111', groupId: 'security', expanded: true }
        const failure = async (input) => save(input).then(() => null, (error) => error.code ?? error.name)
        const noSession = await failure(input)
        principal = { id: input.expectedUserId, allowed: false }
        const denied = await failure(input)
        principal = { id: '22222222-2222-4222-8222-222222222222', allowed: true }
        const changedUser = await failure(input)
        principal = { id: input.expectedUserId, allowed: true }
        const invalid = await failure({ ...input, groupId: 'unknown' })
        const blockedDatabaseCalls = databaseCalls
        const result = await save(input)
        console.log(JSON.stringify({ noSession, denied, changedUser, invalid, blockedDatabaseCalls,
            databaseCalls, result, persistedUserId: persisted.userId }))
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
        noSession: 'authentication_required',
        denied: 'permission_denied',
        changedUser: 'authentication_required',
        invalid: 'ZodError',
        blockedDatabaseCalls: 0,
        databaseCalls: 1,
        result: { groupId: 'security', expanded: true },
        persistedUserId: expectedUserId,
    })
})

import { expect, test } from 'bun:test'
import { runBunScript } from '@/tests/Helpers/runBunScript.ts'

test.each([
    ['active', 'admin.users.messages.enabled'],
    ['pending', 'admin.users.messages.invitationRestored'],
] as const)('reports the next activation step for a restored %s user', async (status, message) => {
    const output = await runBunScript(
        `
        import { mock } from 'bun:test'
        mock.module('@tanstack/react-start', () => ({
            createServerFn: () => {
                const builder = {
                    validator: () => builder,
                    handler: (handler) => (input) => handler(input ?? {}),
                }
                return builder
            },
        }))
        mock.module('./server/Auth/Access/authorization.service.ts', () => ({
            requirePermissionService: async () => ({}),
        }))
        mock.module('./server/Auth/transport.server.ts', () => ({
            localizedActionFailure: () => { throw new Error('Unexpected action failure') },
            throwLocalizedQueryError: () => { throw new Error('Unexpected query failure') },
        }))
        mock.module('./server/Admin/UserManagement/users.service.ts', () => ({
            createUserService: async () => undefined,
            disableUserService: async () => undefined,
            enableUserService: async () => ({ status: ${JSON.stringify(status)} }),
            listUsersService: async () => [],
            updateUserService: async () => undefined,
        }))
        const { enableUserHandler } = await import('./features/Admin/UserManagement/middleware.ts')
        console.log(JSON.stringify(await enableUserHandler({ data: { userId: 'fixture-user' } })))
        `,
        { cwd: new URL('../../../..', import.meta.url) },
    )
    expect(JSON.parse(output)).toEqual({ success: true, message })
})

import { expect, mock, test } from 'bun:test'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
const user = {
    id: 'account-user',
    displayName: 'Fixture',
    email: 'fixture@example.com',
    profileImageVersion: null,
    roles: [],
    permissions: [],
    language: 'en' as const,
    themeMode: 'dark' as const,
    accentColor: '#112233',
    navigationGroupPreferences: {},
}
const context = mock((_options: unknown) => ({ user }))
const search = mock((_options: unknown) => ({ section: 'passkeys' }))
mock.module('@tanstack/react-router', () => ({ useRouteContext: context, useSearch: search }))
const { default: useUserSettingsRoute } =
    await import('@/features/UserSettings/Hooks/useUserSettingsRoute.ts')

test('account route uses its authenticated context and section instead of ambient route values', async () => {
    const hook = await mountHook(useUserSettingsRoute)
    try {
        expect(hook.value).toEqual({ user, activeSection: 'passkeys' })
        expect(context).toHaveBeenCalledWith({ from: '/_authenticated/account' })
        expect(search).toHaveBeenCalledWith({ from: '/_authenticated/account' })
    } finally {
        await hook.dispose()
    }
})

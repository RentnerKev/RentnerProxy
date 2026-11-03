import { expect, mock, test } from 'bun:test'
import type { getAuthStateHandler } from '@/features/Auth/middleware.ts'
import { PERMISSIONS, SYSTEM_ROLES } from '@/config/permissions.config.ts'

type AuthState = Awaited<ReturnType<typeof getAuthStateHandler>>
const user: NonNullable<AuthState['user']> = {
    id: 'fixture',
    displayName: 'Fixture',
    email: 'fixture@example.com',
    profileImageVersion: null,
    roles: [],
    permissions: [],
    language: 'en',
    themeMode: 'dark',
    accentColor: '#112233',
    navigationGroupPreferences: {},
}
let state: AuthState = { setupRequired: false, user: null, sessionId: 'session' }
const logout = mock(async () => ({ success: true }))
mock.module('@/features/Auth/middleware.ts', () => ({
    getAuthStateHandler: mock(async () => state),
    logoutHandler: logout,
}))
mock.module('@tanstack/react-router', () => ({
    redirect: (options: { to: string }) => new Error(`redirect:${options.to}`),
}))
const guards = await import('@/features/Auth/route-guards.ts')

test('route guards distinguish setup, anonymous, missing app access, role ownership and explicit permissions', async () => {
    state = { setupRequired: true, user: null, sessionId: 'session' }
    expect(await guards.requireSetupRoute()).toBe(state)
    await expect(guards.requireAnonymousRoute()).rejects.toThrow('redirect:/setup')
    await expect(guards.requireInitializedRoute()).rejects.toThrow('redirect:/setup')
    await expect(guards.requireAuthenticatedRoute()).rejects.toThrow('redirect:/setup')
    state = { ...state, setupRequired: false }
    await expect(guards.requireSetupRoute()).rejects.toThrow('redirect:/login')
    expect(await guards.requireAnonymousRoute()).toBe(state)
    expect(await guards.requireInitializedRoute()).toBe(state)
    await expect(guards.requireAuthenticatedRoute()).rejects.toThrow('redirect:/login')
    state = { ...state, user }
    await expect(guards.requireSetupRoute()).rejects.toThrow('redirect:/')
    await expect(guards.requireAnonymousRoute()).rejects.toThrow('redirect:/')
    await expect(guards.requireAuthenticatedRoute()).rejects.toThrow('redirect:/login')
    expect(logout).toHaveBeenCalledTimes(1)
    expect(() => guards.requireOwnerRoute({ context: { user } })).toThrow('redirect:/')
    expect(() =>
        guards.requirePermissionRoute(PERMISSIONS.APP_ACCESS)({ context: { user } }),
    ).toThrow('redirect:/')
    const allowed = { ...user, roles: [SYSTEM_ROLES.OWNER], permissions: [PERMISSIONS.APP_ACCESS] }
    state = { ...state, user: allowed }
    expect(await guards.requireAuthenticatedRoute()).toEqual({
        user: allowed,
        sessionId: 'session',
    })
    expect(guards.requireOwnerRoute({ context: { user: allowed } })).toBeUndefined()
    expect(
        guards.requirePermissionRoute(PERMISSIONS.APP_ACCESS)({ context: { user: allowed } }),
    ).toBeUndefined()
})

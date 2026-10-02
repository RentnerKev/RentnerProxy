import { describe, expect, mock, test } from 'bun:test'
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    isRedirect,
    RouterProvider,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToString } from 'react-dom/server'
import { Window } from 'happy-dom'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import getApplicationShellViewModel from '@/lib/ApplicationShell/applicationShell.ts'
import type { AuthenticatedUser } from '@/shared/Types/auth.types.ts'
import type { PermissionKey } from '@/shared/Types/permissions-config.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'
import ApplicationNavigation from '@/layouts/AuthenticatedLayout/Components/ApplicationShell/Components/ApplicationNavigation/index.tsx'

const getSettings = mock(async () => ({
    baseRevision: 'revision-1',
    settings: { mode: 'not-found' as const },
}))
mock.module('@/features/DefaultSite/middleware.ts', () => ({
    getDefaultSiteHandler: getSettings,
    saveDefaultSiteHandler: async () => ({
        success: true,
        message: 'defaultSite.saved',
        runtimeStatus: 'applied',
    }),
}))
mock.module('@/features/Auth/middleware.ts', () => ({
    getAuthStateHandler: async () => ({ setupRequired: false, user: null }),
    logoutHandler: async () => undefined,
}))
const { Route: OperationsRoute } = await import('@/routes/_authenticated/operations.tsx')
const { requireOperationsRoute } = await import('@/features/DefaultSite/route-guards.ts')
const { default: OperationsPage } = await import('@/features/DefaultSite/index.tsx')
const user: AuthenticatedUser = {
    id: 'operations-viewer',
    displayName: 'Viewer',
    email: 'viewer@example.test',
    roles: ['Viewer'],
    permissions: [],
    profileImageVersion: null,
    language: 'en',
    themeMode: 'light',
}

describe('Operations page and navigation', () => {
    test.each([false, true])('requires VIEW for the route: allowed=%s', (allowed) => {
        const context = {
            user: { ...user, permissions: allowed ? [PERMISSIONS.DEFAULT_SITE_VIEW] : [] },
        }
        expect(OperationsRoute.options.beforeLoad).toBe(requireOperationsRoute)
        if (allowed) {
            expect(() => requireOperationsRoute({ context })).not.toThrow()
        } else {
            let result: unknown
            try {
                requireOperationsRoute({ context })
            } catch (error) {
                result = error
            }
            expect(isRedirect(result)).toBe(true)
            if (isRedirect(result)) expect(result.options.to).toBe('/')
        }
    })

    test.each([false, true])(
        'places the permission-gated Operations link in Operations: visible=%s',
        async (visible) => {
            const viewer = { ...user, permissions: visible ? [PERMISSIONS.DEFAULT_SITE_VIEW] : [] }
            const items = getApplicationShellViewModel(viewer, (key) =>
                key === 'operations.page.title' ? 'Operations' : key,
            ).navigationItems
            const root = createRootRoute({
                component: () => <ApplicationNavigation items={items} />,
            })
            const router = createRouter({
                routeTree: root,
                history: createMemoryHistory({ initialEntries: ['/'] }),
            })
            await router.load()
            const window = new Window()
            window.document.write(
                renderToString(withTestLanguage(<RouterProvider router={router} />)),
            )
            try {
                const link = window.document.querySelector('a[href="/operations"]')
                expect(!!link).toBe(visible)
                if (visible) {
                    expect(link?.textContent?.trim()).toBe('Operations')
                    expect(
                        link?.closest('section')?.querySelector('button')?.textContent,
                    ).toContain('Operations')
                }
            } finally {
                await window.happyDOM.close()
            }
        },
    )

    test('does not mount the panel or query without VIEW permission', () => {
        expect(
            renderToString(
                withTestLanguage(
                    <OperationsPage
                        permissions={[
                            PERMISSIONS.DEFAULT_SITE_UPDATE,
                            PERMISSIONS.PROXY_HOSTS_APPLY,
                        ]}
                    />,
                ),
            ),
        ).toBe('')
        expect(getSettings).not.toHaveBeenCalled()
    })

    test.each(
        (
            [
                [PERMISSIONS.DEFAULT_SITE_VIEW],
                [PERMISSIONS.DEFAULT_SITE_VIEW, PERMISSIONS.DEFAULT_SITE_UPDATE],
                [PERMISSIONS.DEFAULT_SITE_VIEW, PERMISSIONS.PROXY_HOSTS_APPLY],
                [
                    PERMISSIONS.DEFAULT_SITE_VIEW,
                    PERMISSIONS.DEFAULT_SITE_UPDATE,
                    PERMISSIONS.PROXY_HOSTS_APPLY,
                ],
            ] satisfies PermissionKey[][]
        ).map((permissions) => ({ permissions })),
    )('requires UPDATE and APPLY for page editing: %j', ({ permissions }) => {
        const client = new QueryClient()
        client.setQueryData(['default-site'], {
            baseRevision: 'revision-1',
            settings: { mode: 'not-found' },
        })
        const html = renderToString(
            withTestLanguage(
                <QueryClientProvider client={client}>
                    <OperationsPage permissions={permissions} />
                </QueryClientProvider>,
            ),
        )
        expect(html).toContain('default-site-heading')
        expect(html.includes('type="submit"')).toBe(permissions.length === 3)
        expect(html).toContain('Operations')
        client.clear()
    })
})

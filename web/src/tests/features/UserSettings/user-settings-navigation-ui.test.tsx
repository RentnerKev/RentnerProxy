import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import { TOOLTIP_PROVIDER_PROPS } from '@/config/tooltip.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
    useRouterState,
} = await import('@tanstack/react-router')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { ToastProvider } = await import('@rentnerkev/toasts')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { default: withTestLanguage } = await import('@/tests/Helpers/withTestLanguage.tsx')
const { SystemAccentContext } = await import('@/shared/Theme/systemAccentContext.ts')
const settingsServer = await import('@/features/UserSettings/middleware.ts')
const securityStatus = spyOn(settingsServer, 'getSecurityStatusHandler').mockResolvedValue({
    passkeys: [],
    recentlyAuthenticated: true,
    recoveryCodesRemaining: 0,
    totpEnabled: false,
})
const changePassword = spyOn(settingsServer, 'changePasswordHandler').mockResolvedValue({
    success: true,
    message: 'account.password.success.changed',
})
const { getUserSettingsSearch } = await import('@/lib/UserSettings/userSettingsPage.ts')
const { default: UserSettingsPage } = await import('@/features/UserSettings/index.tsx')

const testUser = {
    displayName: 'Kevin Example',
    email: 'kevin@example.test',
    id: 'user-settings-navigation-test',
    language: 'en',
    permissions: [
        PERMISSIONS.ACCOUNT_VIEW,
        PERMISSIONS.ACCOUNT_UPDATE,
        PERMISSIONS.SYSTEM_APPEARANCE_UPDATE,
    ],
    profileImageVersion: null,
    roles: ['Owner'],
    themeMode: 'light',
} satisfies AuthenticatedUser

const testAccent = { accentColor: '#3366cc', setAccentColor: () => undefined }

let activeRoot: Root | null = null
let activeQueryClient: InstanceType<typeof QueryClient> | null = null
function createSettingsRouter(initialPath: string, user: AuthenticatedUser) {
    const rootRoute = createRootRoute()

    function AccountSettingsRoute() {
        const { section } = useRouterState({
            select: (state) => getUserSettingsSearch(state.location.search),
        })
        return <UserSettingsPage user={user} activeSection={section} />
    }

    const accountRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/account',
        validateSearch: getUserSettingsSearch,
        component: AccountSettingsRoute,
    })

    return createRouter({
        routeTree: rootRoute.addChildren([accountRoute]),
        history: createMemoryHistory({ initialEntries: [initialPath] }),
    })
}

async function render(
    initialPath: string,
    permissions: ReadonlyArray<PermissionKey> = testUser.permissions,
) {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = createRoot(container)
    activeQueryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false },
        },
    })
    const user = { ...testUser, permissions }
    const testRouter = createSettingsRouter(initialPath, user)
    await testRouter.load()

    await act(async () => {
        activeRoot?.render(
            withTestLanguage(
                <TooltipProvider {...TOOLTIP_PROVIDER_PROPS}>
                    <ToastProvider {...TOAST_PROVIDER_PROPS} locale="en">
                        <QueryClientProvider client={activeQueryClient!}>
                            <SystemAccentContext.Provider value={testAccent}>
                                <RouterProvider router={testRouter} />
                            </SystemAccentContext.Provider>
                        </QueryClientProvider>
                    </ToastProvider>
                </TooltipProvider>,
            ),
        )
    })

    return { container, router: testRouter }
}

async function click(element: Element): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await Promise.resolve()
    })
}

async function waitFor(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 1_500
    while (!condition() && Date.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop -- Wait for the router's next rendered location.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    }
    expect(condition()).toBe(true)
}

function activeNavigationLabel(container: HTMLElement): string | undefined {
    return container.querySelector('nav [aria-current="page"] span')?.textContent?.trim()
}

function navigationLink(container: HTMLElement, label: string): HTMLAnchorElement {
    const link = [...container.querySelectorAll<HTMLAnchorElement>('nav a')].find((candidate) =>
        candidate.textContent?.trim().startsWith(label),
    )
    expect(link).toBeDefined()
    return link!
}

afterEach(async () => {
    await act(async () => activeRoot?.unmount())
    activeRoot = null
    activeQueryClient?.clear()
    activeQueryClient = null
    securityStatus.mockClear()
    changePassword.mockClear()
    document.body.replaceChildren()
})

afterAll(() => {
    securityStatus.mockRestore()
    changePassword.mockRestore()
})

describe('user settings navigation', () => {
    test('validates the URL section and falls back to the profile section for invalid search', async () => {
        const { container, router } = await render('/account?section=unknown')

        expect(router.state.location.search).toEqual({ section: 'profile' })
        expect(
            container.querySelector('nav [aria-current="page"]')?.getAttribute('href'),
        ).toContain('section=profile')
        expect(activeNavigationLabel(container)).toBe('My profile')
        expect(container.querySelector('[aria-labelledby="profile-image-title"]')).not.toBeNull()
    })

    test('follows real links, restores the previous section, and preserves a password draft', async () => {
        const { container, router } = await render('/account?section=profile')
        await click(navigationLink(container, 'Password'))
        await waitFor(() => router.state.location.search.section === 'password')

        const passwordInput = container.querySelector<HTMLInputElement>(
            'input[name="currentPassword"]',
        )!
        await setInputValue(passwordInput, 'unsent draft')
        await click(navigationLink(container, 'My profile'))
        await waitFor(() => router.state.location.search.section === 'profile')
        expect(activeNavigationLabel(container)).toBe('My profile')

        await act(async () => {
            router.history.back()
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
        await waitFor(() => router.state.location.search.section === 'password')

        expect(activeNavigationLabel(container)).toBe('Password')
        expect(
            container.querySelector<HTMLInputElement>('input[name="currentPassword"]')?.value,
        ).toBe('unsent draft')

        await act(async () => {
            router.history.forward()
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
        await waitFor(() => router.state.location.search.section === 'profile')
        expect(activeNavigationLabel(container)).toBe('My profile')

        await act(async () => {
            router.history.back()
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
        await waitFor(() => router.state.location.search.section === 'password')
        expect(
            container.querySelector<HTMLInputElement>('input[name="currentPassword"]')?.value,
        ).toBe('unsent draft')
        expect(changePassword).not.toHaveBeenCalled()
    })

    test('keeps profile image and appearance controls behind their existing permissions', async () => {
        const { container, router } = await render('/account?section=profile', [
            PERMISSIONS.ACCOUNT_VIEW,
        ])
        const profileImageInput = container.querySelector<HTMLInputElement>(
            'input[aria-label="Choose profile picture"]',
        )
        expect(profileImageInput?.disabled).toBe(true)
        expect(container.textContent).toContain(
            'You do not have permission to update this profile picture.',
        )

        await click(navigationLink(container, 'Appearance'))
        await waitFor(() => router.state.location.search.section === 'appearance')
        expect(activeNavigationLabel(container)).toBe('Appearance')
        expect(
            container.querySelector('[aria-labelledby="system-appearance-heading"] form'),
        ).toBeNull()
        expect(container.textContent).toContain(
            'Only administrators can change the system accent color.',
        )
    })
})

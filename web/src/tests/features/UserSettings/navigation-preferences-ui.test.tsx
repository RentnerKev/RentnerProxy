import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { StrictMode, type ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { PERMISSION_REGISTRY } from '@/config/permissions.config.ts'
import type {
    NavigationGroupId,
    NavigationGroupPreferences,
} from '@/config/Types/navigation-config.types.ts'
import type { NavigationGroupUpdateResult } from '@/features/UserSettings/Types/navigation-server-result.types.ts'
import type { ApplicationNavigationItem } from '@/layouts/AuthenticatedLayout/Components/ApplicationShell/Types/application-shell.types.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type { AppLanguage } from '@/shared/Language/Types/language.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterContextProvider } =
    await import('@tanstack/react-router')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { default: ApplicationNavigation } =
    await import('@/layouts/AuthenticatedLayout/Components/ApplicationShell/Components/ApplicationNavigation/index.tsx')
const { default: AuthenticatedShell } =
    await import('@/layouts/AuthenticatedLayout/Components/ApplicationShell/index.tsx')
const { default: useNavigationGroupPreferencesLogic } =
    await import('@/layouts/AuthenticatedLayout/Hooks/useNavigationGroupPreferences.ts')
const settingsServer = await import('@/features/UserSettings/middleware.ts')
const { toast } = await import('@rentnerkev/toasts/toast')
type NavigationSaver = (
    ...args: Parameters<typeof settingsServer.updateCurrentUserNavigationGroupHandler>
) => ReturnType<typeof settingsServer.updateCurrentUserNavigationGroupHandler>
const navigationServer: { updateCurrentUserNavigationGroupHandler: NavigationSaver } =
    settingsServer
const save = spyOn(navigationServer, 'updateCurrentUserNavigationGroupHandler')
const errorToast = spyOn(toast, 'error')

const userId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '22222222-2222-4222-8222-222222222222'
type PreferenceUser = Pick<AuthenticatedUser, 'id' | 'navigationGroupPreferences'>
const items: readonly ApplicationNavigationItem[] = [
    { to: '/', label: 'Overview', exact: true },
    { to: '/proxy-hosts', label: 'Proxy hosts' },
    { to: '/access-policies', label: 'Access policies' },
    { to: '/users', label: 'Users' },
    { to: '/audit-logs', label: 'Audit log' },
]
const persisted = new Map<string, NavigationGroupPreferences>()
let activeRoot: Root | null = null
let queryClient: InstanceType<typeof QueryClient> | null = null
let container: HTMLElement
let router: ReturnType<typeof createTestRouter>

function createTestRouter(path: string) {
    const rootRoute = createRootRoute()
    const routes = items.map((item) =>
        createRoute({ getParentRoute: () => rootRoute, path: item.to }),
    )
    return createRouter({
        routeTree: rootRoute.addChildren(routes),
        history: createMemoryHistory({ initialEntries: [path] }),
    })
}

function Harness({
    user,
    visibleItems = items,
    shell = false,
}: {
    readonly user: PreferenceUser
    readonly visibleItems?: readonly ApplicationNavigationItem[]
    readonly shell?: boolean
}) {
    const preferences = useNavigationGroupPreferencesLogic(user)
    return shell ? (
        <AuthenticatedShell
            user={{
                id: user.id,
                displayName: 'Test user',
                email: 'test@example.invalid',
                permissions: PERMISSION_REGISTRY.map(({ key }) => key),
                profileImageVersion: null,
            }}
            isLoggingOut={false}
            onLogout={() => undefined}
            themeMode="light"
            themeControl={<button type="button">Theme</button>}
            navigationGroupPreferences={preferences.preferences}
            onNavigationGroupChange={preferences.updateGroup}
        >
            <div>Content</div>
        </AuthenticatedShell>
    ) : (
        <ApplicationNavigation
            items={visibleItems}
            groupPreferences={preferences.preferences}
            onGroupChange={preferences.updateGroup}
        />
    )
}

interface RenderOptions {
    readonly language?: AppLanguage
    readonly visibleItems?: readonly ApplicationNavigationItem[]
    readonly shell?: boolean
    readonly strict?: boolean
}

async function render(user: PreferenceUser, options: RenderOptions = {}) {
    const harness = (
        <Harness
            key={user.id}
            user={user}
            visibleItems={options.visibleItems ?? items}
            shell={options.shell ?? false}
        />
    )
    const element: ReactElement = options.strict ? <StrictMode>{harness}</StrictMode> : harness
    await act(async () => {
        activeRoot?.render(
            <QueryClientProvider client={queryClient!}>
                <RouterContextProvider router={router}>
                    {withTestLanguage(element, options.language)}
                </RouterContextProvider>
            </QueryClientProvider>,
        )
    })
}

async function mount(
    user: PreferenceUser = { id: userId },
    options: RenderOptions & { readonly path?: string } = {},
) {
    save.mockImplementation(async ({ data }) => {
        persisted.set(data.expectedUserId, {
            ...persisted.get(data.expectedUserId),
            [data.groupId]: data.expanded,
        })
        return { success: true, groupId: data.groupId, expanded: data.expanded }
    })
    container = document.createElement('div')
    document.body.append(container)
    activeRoot = createRoot(container)
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    router = createTestRouter(options.path ?? '/')
    await router.load()
    await render(user, options)
}

function groupButtons(groupId: NavigationGroupId) {
    return [
        ...container.querySelectorAll<HTMLButtonElement>(
            `nav section > button[aria-controls$="-${groupId}"]`,
        ),
    ]
}

function expanded(groupId: NavigationGroupId) {
    return groupButtons(groupId)[0]?.getAttribute('aria-expanded') === 'true'
}

async function click(element: Element) {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
}

async function settle() {
    await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
}

function deferredResult() {
    let resolve!: (result: NavigationGroupUpdateResult) => void
    const promise = new Promise<NavigationGroupUpdateResult>((done) => {
        resolve = done
    })
    return { promise, resolve }
}

afterEach(async () => {
    await act(async () => activeRoot?.unmount())
    activeRoot = null
    queryClient?.clear()
    queryClient = null
    document.body.replaceChildren()
    persisted.clear()
    save.mockClear()
    errorToast.mockClear()
})

afterAll(() => {
    save.mockRestore()
    errorToast.mockRestore()
})

describe('persisted navigation groups', () => {
    test('keeps existing defaults and does not write while rendering, navigating, or changing language', async () => {
        await mount({ id: userId }, { path: '/audit-logs' })
        expect(expanded('records')).toBeTrue()
        expect(expanded('operations')).toBeFalse()
        await act(async () => router.navigate({ to: '/proxy-hosts' }))
        expect(expanded('operations')).toBeTrue()
        await render({ id: userId }, { language: 'de' })
        expect(groupButtons('operations')[0]?.textContent).toContain('Betrieb')
        expect(save).not.toHaveBeenCalled()
    })

    test('restores deliberate expanded and collapsed choices after navigation and a new login', async () => {
        await mount()
        await click(groupButtons('operations')[0]!)
        await click(groupButtons('security')[0]!)
        await settle()
        await act(async () => router.navigate({ to: '/proxy-hosts' }))
        expect(expanded('operations')).toBeFalse()
        expect(expanded('security')).toBeTrue()
        const stored = persisted.get(userId)!
        expect(stored).toEqual({ operations: false, security: true })
        await act(async () => activeRoot?.unmount())
        activeRoot = createRoot(container)
        await render({ id: userId, navigationGroupPreferences: stored })
        expect(expanded('operations')).toBeFalse()
        expect(expanded('security')).toBeTrue()
        expect(save).toHaveBeenCalledTimes(2)
    })

    test('updates immediately and restores the default on a rejected save with a localized error', async () => {
        await mount({ id: userId }, { language: 'de' })
        const pending = deferredResult()
        save.mockImplementationOnce(() => pending.promise)
        await click(groupButtons('operations')[0]!)
        expect(expanded('operations')).toBeFalse()
        await act(async () =>
            pending.resolve({ success: false, message: 'shell.navigationSaveFailed' }),
        )
        await settle()
        expect(expanded('operations')).toBeTrue()
        expect(errorToast.mock.calls[0]?.[0]).toBe(
            'Deine Navigation konnte nicht gespeichert werden. Versuche es erneut.',
        )
    })

    test('restores a confirmed preference when the request fails at the transport', async () => {
        await mount({ id: userId, navigationGroupPreferences: { security: true } })
        save.mockRejectedValueOnce(new Error('Offline'))
        await click(groupButtons('security')[0]!)
        await settle()
        expect(expanded('security')).toBeTrue()
        expect(errorToast).toHaveBeenCalledTimes(1)
    })

    test('serializes rapid changes and rolls back to the latest confirmed value', async () => {
        await mount()
        const first = deferredResult()
        const second = deferredResult()
        save.mockImplementationOnce(() => first.promise)
        save.mockImplementationOnce(() => second.promise)
        await click(groupButtons('operations')[0]!)
        await click(groupButtons('operations')[0]!)
        expect(expanded('operations')).toBeTrue()
        expect(save).toHaveBeenCalledTimes(1)
        await act(async () =>
            first.resolve({ success: true, groupId: 'operations', expanded: false }),
        )
        await settle()
        expect(save).toHaveBeenCalledTimes(2)
        expect(expanded('operations')).toBeTrue()
        await act(async () =>
            second.resolve({ success: false, message: 'shell.navigationSaveFailed' }),
        )
        await settle()
        expect(expanded('operations')).toBeFalse()
    })

    test('does not let an older failure overwrite a newer choice or notify after a successful retry', async () => {
        await mount()
        const first = deferredResult()
        save.mockImplementationOnce(() => first.promise)
        await click(groupButtons('operations')[0]!)
        await click(groupButtons('operations')[0]!)
        await act(async () =>
            first.resolve({ success: false, message: 'shell.navigationSaveFailed' }),
        )
        await settle()
        expect(expanded('operations')).toBeTrue()
        expect(persisted.get(userId)).toEqual({ operations: true })
        expect(errorToast).not.toHaveBeenCalled()
    })

    test('rolls back only the failed group when another group is queued', async () => {
        await mount()
        const first = deferredResult()
        save.mockImplementationOnce(() => first.promise)
        await click(groupButtons('security')[0]!)
        await click(groupButtons('administration')[0]!)
        expect(expanded('security')).toBeTrue()
        expect(expanded('administration')).toBeTrue()
        await act(async () =>
            first.resolve({ success: false, message: 'shell.navigationSaveFailed' }),
        )
        await settle()
        expect(expanded('security')).toBeFalse()
        expect(expanded('administration')).toBeTrue()
        expect(persisted.get(userId)).toEqual({ administration: true })
    })

    test('retains preferences across permission and localization changes and defaults new groups safely', async () => {
        const user = {
            id: userId,
            navigationGroupPreferences: { security: true, operations: false },
        }
        await mount(user)
        await render(user, { visibleItems: items.filter((item) => item.to === '/') })
        expect(groupButtons('security')).toHaveLength(0)
        await render(user, { language: 'de' })
        expect(expanded('security')).toBeTrue()
        expect(expanded('operations')).toBeFalse()
        expect(expanded('administration')).toBeFalse()
        await act(async () => router.navigate({ to: '/users' }))
        expect(expanded('administration')).toBeTrue()
        expect(save).not.toHaveBeenCalled()
    })

    test('ignores stale IDs and malformed entries without dropping valid preferences', async () => {
        await mount(
            {
                id: userId,
                navigationGroupPreferences: {
                    operations: false,
                    security: 'invalid',
                    removed: true,
                } as unknown as NavigationGroupPreferences,
            },
            { path: '/access-policies' },
        )
        expect(expanded('operations')).toBeFalse()
        expect(expanded('security')).toBeTrue()
        expect(groupButtons('records')).toHaveLength(1)
        expect(save).not.toHaveBeenCalled()
    })

    test('isolates users and cancels queued requests after the old layout unmounts', async () => {
        await mount()
        const pending = deferredResult()
        save.mockImplementationOnce(() => pending.promise)
        await click(groupButtons('security')[0]!)
        await click(groupButtons('administration')[0]!)
        await render({ id: otherUserId, navigationGroupPreferences: { records: true } })
        expect(expanded('security')).toBeFalse()
        expect(expanded('records')).toBeTrue()
        await act(async () =>
            pending.resolve({ success: true, groupId: 'security', expanded: true }),
        )
        await settle()
        expect(save).toHaveBeenCalledTimes(1)
        expect(save.mock.calls[0]?.[0].data.expectedUserId).toBe(userId)
        expect(expanded('security')).toBeFalse()
        expect(errorToast).not.toHaveBeenCalled()
    })

    test('shares changes between desktop and mobile navigation and remembers them when the mobile menu remounts', async () => {
        await mount({ id: userId }, { shell: true })
        await click(groupButtons('security')[0]!)
        const menuToggle = container.querySelector<HTMLButtonElement>(
            'button[aria-controls="application-mobile-navigation"]',
        )!
        await click(menuToggle)
        expect(groupButtons('security')).toHaveLength(2)
        expect(
            groupButtons('security').map((button) => button.getAttribute('aria-expanded')),
        ).toEqual(['true', 'true'])
        const controls = groupButtons('security').map((button) =>
            button.getAttribute('aria-controls'),
        )
        expect(new Set(controls).size).toBe(2)
        await click(groupButtons('security')[1]!)
        expect(
            groupButtons('security').map((button) => button.getAttribute('aria-expanded')),
        ).toEqual(['false', 'false'])
        await click(menuToggle)
        await click(menuToggle)
        expect(
            groupButtons('security').map((button) => button.getAttribute('aria-expanded')),
        ).toEqual(['false', 'false'])
        await settle()
        expect(persisted.get(userId)).toEqual({ security: false })
        expect(save).toHaveBeenCalledTimes(2)
    })

    test('writes exactly once per intentional toggle under StrictMode', async () => {
        await mount({ id: userId }, { strict: true })
        expect(save).not.toHaveBeenCalled()
        await click(groupButtons('security')[0]!)
        await settle()
        expect(save).toHaveBeenCalledTimes(1)
        await render({ id: userId }, { strict: true })
        expect(save).toHaveBeenCalledTimes(1)
    })
})

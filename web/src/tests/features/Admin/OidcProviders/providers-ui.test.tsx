// oxlint-disable no-map-spread -- Immutable API snapshots model successive server revisions.
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type {
    OidcProvidersSummary,
    SaveOidcProvidersInput,
} from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import { PERMISSIONS, SYSTEM_ROLES } from '@/config/permissions.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import getApplicationShellViewModel from '@/lib/ApplicationShell/applicationShell.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered)
    GlobalRegistrator.register({ settings: { device: { prefersReducedMotion: 'reduce' } } })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const userId = '11111111-1111-4111-8111-111111111111'
mock.module('@/features/Admin/UserManagement/middleware.ts', () => ({
    getUsersHandler: mock(async () => [
        {
            id: userId,
            displayName: 'Alice',
            email: 'alice@example.test',
            status: 'active',
            roleKeys: ['member'],
        },
    ]),
}))
mock.module('@/features/Admin/RoleManagement/middleware.ts', () => ({
    getRolesHandler: mock(async () => [
        { key: 'member', permissionKeys: [PERMISSIONS.APP_ACCESS] },
    ]),
}))
mock.module('@/features/Auth/middleware.ts', () => ({
    getAuthStateHandler: mock(async () => ({ setupRequired: false, user: null })),
    logoutHandler: mock(async () => {}),
}))
const verifyPassword = mock(async (_input: unknown) => ({ success: true, message: 'ok' }))
const beginPasskey = mock(async () => ({
    success: false,
    message: 'account.reauthentication.error.failed',
}))
mock.module('@/features/UserSettings/middleware.ts', () => ({
    reauthenticatePasswordHandler: verifyPassword,
    beginPasskeyReauthenticationHandler: beginPasskey,
    finishPasskeyReauthenticationHandler: mock(async () => ({ success: true })),
}))
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { toast } = await import('@rentnerkev/toasts')
const { default: Page } = await import('@/features/Admin/OidcProviders/index.tsx')
const { Route: ProvidersRoute } = await import('@/routes/_authenticated/identity-providers.tsx')
const { requireOwnerRoute } = await import('@/features/Auth/route-guards.ts')
const { createRootRouteWithContext, createRoute, createRouter, createMemoryHistory } =
    await import('@tanstack/react-router')
let root: Root | undefined
let client: InstanceType<typeof QueryClient>
let snapshot: OidcProvidersSummary
let failure: string | null
let pendingSave: Promise<void> | null
let pendingRead: Promise<void> | null
let readUnavailable: boolean
const writes: SaveOidcProvidersInput[] = []
const probes: unknown[] = []
const feedback: { kind: string; message: unknown }[] = []
let restores: (() => void)[] = []
function initial(): OidcProvidersSummary {
    return {
        revision: 7,
        callbackUrl: 'https://proxy.example.test/api/auth/oidc/callback',
        providers: [
            {
                id: '22222222-2222-4222-8222-222222222222',
                name: 'Company SSO',
                enabled: false,
                issuer: 'https://id.example.test',
                clientId: 'proxy',
                tokenEndpointAuthMethod: 'client_secret_basic',
                allowedEndpointOrigins: ['https://id.example.test'],
                allowedPrivateCidrs: [],
                bindings: [],
                revision: 7,
                credentialConfigured: true,
            },
        ],
    }
}
beforeEach(() => {
    snapshot = initial()
    failure = null
    pendingSave = null
    pendingRead = null
    readUnavailable = false
    writes.length = 0
    probes.length = 0
    feedback.length = 0
    verifyPassword.mockClear()
    beginPasskey.mockClear()
    restores = (['success', 'error'] as const).map((kind) => {
        const spy = spyOn(toast, kind).mockImplementation((message) => {
            feedback.push({ kind, message })
            return 'toast'
        })
        return () => spy.mockRestore()
    })
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
        Object.assign(
            async (input: string | URL | Request, init?: RequestInit) => {
                expect(String(input)).toStartWith('/api/admin/oidc/providers')
                expect(init?.credentials).toBe('same-origin')
                expect(init?.cache).toBe('no-store')
                if (init?.method === 'POST') {
                    const body = JSON.parse(String(init.body)) as SaveOidcProvidersInput
                    if (String(input).endsWith('/test')) probes.push(body)
                    else {
                        writes.push(body)
                        await pendingSave
                    }
                    if (failure)
                        return new Response(JSON.stringify({ error: failure }), { status: 599 })
                    if (!String(input).endsWith('/test'))
                        snapshot = {
                            ...snapshot,
                            revision: snapshot.revision + 1,
                            providers: body.providers.map(
                                ({ clientSecret: _secret, ...provider }) => ({
                                    ...provider,
                                    credentialConfigured: true,
                                    revision: snapshot.revision + 1,
                                }),
                            ),
                        }
                } else {
                    await pendingRead
                    if (readUnavailable)
                        return Response.json(
                            { error: 'configuration_unavailable' },
                            { status: 503 },
                        )
                }
                return Response.json(
                    String(input).endsWith('/test')
                        ? { status: 'metadata_verified', callbackUrl: snapshot.callbackUrl }
                        : snapshot,
                )
            },
            { preconnect: globalThis.fetch.preconnect },
        ),
    )
    restores.push(() => fetchSpy.mockRestore())
})
afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    client?.clear()
    document.body.replaceChildren()
    restores.forEach((restore) => restore())
})
async function waitFor(condition: () => boolean) {
    const deadline = Date.now() + 2500
    async function poll(): Promise<void> {
        if (condition()) return
        if (Date.now() > deadline)
            throw new Error(`OIDC timeout: ${document.body.textContent?.slice(-1400)}`)
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
        await poll()
    }
    await poll()
}
async function render() {
    client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
        root!.render(
            withTestLanguage(
                <QueryClientProvider client={client}>
                    <Page />
                </QueryClientProvider>,
            ),
        ),
    )
    await waitFor(() => document.body.textContent?.includes('Company SSO') === true)
}
function button(label: string, scope: ParentNode = document) {
    const result = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent?.trim() === label,
    )
    if (!result) throw new Error(`Missing button ${label}: ${scope.textContent}`)
    return result
}
async function click(element: Element) {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
}
async function fill(id: string, value: string) {
    const element = document.getElementById(id) as HTMLInputElement
    expect(element).not.toBeNull()
    await act(async () => {
        Object.getOwnPropertyDescriptor(
            element instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype,
            'value',
        )!.set!.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
    })
}
async function submit() {
    await act(async () => {
        document
            .querySelector('form')!
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
}
function dialog() {
    return document.querySelector<HTMLElement>('[role="dialog"]')!
}
function visible(account: AuthenticatedUser) {
    return getApplicationShellViewModel(account, (key) => key).navigationItems.some(
        (item) => item.to === '/identity-providers',
    )
}

describe('OIDC provider setup UI', () => {
    test('only owners receive navigation and the actual route guard redirects a fully privileged nonowner', async () => {
        const user: AuthenticatedUser = {
            id: userId,
            displayName: 'Admin',
            email: 'admin@example.test',
            profileImageVersion: null,
            roles: ['admin'],
            permissions: Object.values(PERMISSIONS),
            language: 'en',
            themeMode: 'light',
        }
        expect(visible(user)).toBe(false)
        const owner = { ...user, roles: [SYSTEM_ROLES.OWNER] }
        expect(visible(owner)).toBe(true)
        expect(ProvidersRoute.options.beforeLoad).toBe(requireOwnerRoute)
        await Promise.all(
            (
                [
                    [user, '/'],
                    [owner, '/identity-providers'],
                ] as const
            ).map(async ([account, expected]) => {
                const routeRoot = createRootRouteWithContext<{ user: AuthenticatedUser }>()()
                const router = createRouter({
                    routeTree: routeRoot.addChildren([
                        createRoute({ getParentRoute: () => routeRoot, path: '/' }),
                        createRoute({
                            getParentRoute: () => routeRoot,
                            path: '/identity-providers',
                            beforeLoad: requireOwnerRoute,
                        }),
                    ]),
                    context: { user: account },
                    history: createMemoryHistory({ initialEntries: ['/identity-providers'] }),
                })
                await router.load()
                expect(router.state.location.pathname).toBe(expected)
            }),
        )
    })
    test('keeps saved cards visible through refresh and reports an unavailable refresh with a toast', async () => {
        await render()
        const card = document.querySelector('article')!
        let release!: () => void
        pendingRead = new Promise((resolve) => {
            release = resolve
        })
        await click(button('Refresh'))
        expect(document.querySelector('article') === card).toBe(true)
        expect(document.querySelector('[role="status"]')).toBeNull()
        readUnavailable = true
        await act(async () => release())
        await waitFor(() => feedback.some((item) => item.kind === 'error'))
        expect(button('Add provider').disabled).toBe(true)
        expect(writes).toHaveLength(0)
    })
    test('Escape closes the editor and clears a draft client secret before reopening', async () => {
        await render()
        await click(button('Add provider'))
        await fill('oidc-client-secret', 'discarded-fixture-secret')
        await act(async () => {
            document.activeElement?.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
            )
        })
        await waitFor(() => !dialog())
        await click(button('Add provider'))
        expect((document.getElementById('oidc-client-secret') as HTMLInputElement).value).toBe('')
        expect(writes).toHaveLength(0)
    })
    test('adds and removes bindings without treating an arbitrary subject as an email', async () => {
        await render()
        await click(button('Edit provider'))
        await click(button('Add binding'))
        const subject = 'urn:corp:user|CaseSensitive!#$%&*+=:;?@[]{}'
        await fill('oidc-subject-0', subject)
        await click(document.getElementById('oidc-user-0')!)
        await waitFor(() => document.querySelector('[role="option"]') !== null)
        const alice = [...document.querySelectorAll('[role="option"]')].find((option) =>
            option.textContent?.includes('alice@example.test'),
        )!
        expect(alice).toBeDefined()
        await click(alice)
        await click(button('Add binding'))
        await click(
            [...dialog().querySelectorAll('button')].filter(
                (item) => item.textContent === 'Remove binding',
            )[1]!,
        )
        await submit()
        await waitFor(() => writes.length === 1 && !dialog())
        expect(writes[0]!.providers[0]!.bindings).toEqual([{ subject, userId }])
        await click(button('Edit provider'))
        expect((document.getElementById('oidc-subject-0') as HTMLInputElement).disabled).toBe(true)
        await click(button('Remove binding'))
        await submit()
        await waitFor(() => writes.length === 2 && !dialog())
        expect(writes[1]!.providers[0]!.bindings).toEqual([])
    })
    test('reauthentication clears closed credentials, preserves the draft, and allows an explicit retry', async () => {
        await render()
        await click(button('Edit provider'))
        await fill('oidc-name', 'Draft after reauth')
        failure = 'reauthentication_required'
        await submit()
        await waitFor(() => document.getElementById('reauth-password') !== null)
        await fill('reauth-password', 'fixture-password')
        const reauthDialog = document.getElementById('reauth-password')!.closest('[role="dialog"]')!
        await click(button('Cancel', reauthDialog))
        expect(document.getElementById('reauth-password')).toBeNull()
        expect((document.getElementById('oidc-name') as HTMLInputElement).value).toBe(
            'Draft after reauth',
        )
        await submit()
        await waitFor(() => document.getElementById('reauth-password') !== null)
        expect((document.getElementById('reauth-password') as HTMLInputElement).value).toBe('')
        await fill('reauth-password', 'second-fixture-password')
        failure = null
        await click(
            button(
                'Confirm',
                document.getElementById('reauth-password')!.closest('[role="dialog"]')!,
            ),
        )
        await waitFor(() => document.getElementById('reauth-password') === null)
        expect(verifyPassword).toHaveBeenCalledTimes(1)
        expect(verifyPassword.mock.calls[0]).toEqual([
            { data: { credential: 'second-fixture-password' } },
        ])
        expect(writes).toHaveLength(2)
        await submit()
        await waitFor(() => writes.length === 3 && !dialog())
        expect(writes[2]!.providers[0]!.name).toBe('Draft after reauth')
        expect(document.body.textContent).not.toContain('fixture-password')
    })
    test('loads safe summaries, creates disabled providers, and closes only after a successful save', async () => {
        await render()
        expect(document.body.textContent).toContain(snapshot.callbackUrl!)
        await click(button('Add provider'))
        expect(dialog()).not.toBeNull()
        expect(dialog().getAttribute('aria-labelledby')).toBeTruthy()
        expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(
            false,
        )
        for (const id of ['oidc-name', 'oidc-issuer', 'oidc-clientId', 'oidc-client-secret'])
            expect(
                (document.getElementById(id) as HTMLInputElement).placeholder.length,
            ).toBeGreaterThan(0)
        await fill('oidc-name', 'New SSO')
        await fill('oidc-issuer', 'https://new.example.test')
        await fill('oidc-clientId', 'new-client')
        await fill('oidc-client-secret', 'fixture-secret')
        await fill('oidc-endpointOrigins', 'https://new.example.test')
        await submit()
        await waitFor(() => writes.length === 1 && !dialog())
        expect(writes[0]!.expectedRevision).toBe(7)
        expect(writes[0]!.providers.find((provider) => provider.name === 'New SSO')).toMatchObject({
            enabled: false,
            clientId: 'new-client',
            clientSecret: 'fixture-secret',
        })
        expect(feedback.some((item) => item.kind === 'success')).toBe(true)
    })
    test('retains an existing secret by omission and guards duplicate submits while pending', async () => {
        await render()
        await click(button('Edit provider'))
        expect((document.getElementById('oidc-client-secret') as HTMLInputElement).value).toBe('')
        let release!: () => void
        pendingSave = new Promise((resolve) => {
            release = resolve
        })
        await fill('oidc-name', 'Renamed SSO')
        await submit()
        await waitFor(() => writes.length === 1)
        await submit()
        expect(writes).toHaveLength(1)
        expect(writes[0]!.providers[0]).not.toHaveProperty('clientSecret')
        expect(dialog()).not.toBeNull()
        await waitFor(() => button('Save changes', dialog()).disabled)
        await act(async () => release())
        await waitFor(() => !dialog())
        expect(document.body.textContent).toContain('Renamed SSO')
    })
    test('bounds unsafe probe errors to a translated toast and preserves the provider list', async () => {
        await render()
        failure = 'upstream says fixture-secret https://private.example.test'
        await click(button('Test saved provider'))
        await waitFor(() => feedback.length > 0)
        expect(probes).toEqual([{ providerId: initial().providers[0]!.id, expectedRevision: 7 }])
        expect(feedback[0]!.kind).toBe('error')
        expect(String(feedback[0]!.message)).not.toMatch(/fixture-secret|private\.example|oidc\./u)
        expect(String(feedback[0]!.message).length).toBeGreaterThan(15)
        expect(document.body.textContent).toContain('Company SSO')
        expect(document.body.textContent).not.toContain('fixture-secret')
    })
    test('a conflict preserves the draft and blocks repeat writes until an explicit reload', async () => {
        await render()
        await click(button('Edit provider'))
        await fill('oidc-name', 'My unsaved name')
        failure = 'configuration_conflict'
        await submit()
        await waitFor(() => feedback.some((item) => item.kind === 'error'))
        expect((document.getElementById('oidc-name') as HTMLInputElement).value).toBe(
            'My unsaved name',
        )
        expect(button('Save changes', dialog()).disabled).toBe(true)
        await submit()
        expect(writes).toHaveLength(1)
        snapshot = { ...snapshot, revision: 9 }
        failure = null
        await click(button('Reload saved configuration?', dialog()))
        const confirmation = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
            (item) => item !== dialog(),
        )!
        expect((document.getElementById('oidc-name') as HTMLInputElement).value).toBe(
            'My unsaved name',
        )
        await click(button('Confirm', confirmation))
        await waitFor(() => !button('Save changes', dialog()).disabled)
        expect((document.getElementById('oidc-name') as HTMLInputElement).value).toBe('Company SSO')
        await fill('oidc-name', 'Explicit retry')
        await submit()
        await waitFor(() => writes.length === 2 && !dialog())
        expect(writes[1]!.expectedRevision).toBe(9)
    })
    test('deletion requires confirmation and cancel leaves configuration intact', async () => {
        await render()
        await click(button('Delete provider'))
        expect(writes).toHaveLength(0)
        expect(dialog().textContent).toContain('Company SSO')
        await click(button('Cancel', dialog()))
        expect(writes).toHaveLength(0)
        await click(button('Delete provider'))
        await click(button('Confirm', dialog()))
        await waitFor(() => writes.length === 1 && !dialog())
        expect(writes[0]).toEqual({ expectedRevision: 7, providers: [] })
        expect(document.querySelector('article')).toBeNull()
        expect(feedback.some((item) => item.kind === 'success')).toBe(true)
    })
})

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
let rolesUnavailable = false
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
    getRolesHandler: mock(async () => {
        if (rolesUnavailable) throw new Error('Role catalog unavailable')
        return [
            { key: 'member', name: 'Member', permissionKeys: [PERMISSIONS.APP_ACCESS] },
            { key: 'operator', name: 'Operator', permissionKeys: [] },
            {
                key: SYSTEM_ROLES.OWNER,
                name: 'Owner',
                isSystem: true,
                permissionKeys: Object.values(PERMISSIONS),
            },
        ]
    }),
}))
mock.module('@/features/Auth/middleware.ts', () => ({
    getAuthStateHandler: mock(async () => ({ setupRequired: false, user: null })),
    logoutHandler: mock(async () => {}),
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
    rolesUnavailable = false
    snapshot = initial()
    failure = null
    pendingSave = null
    pendingRead = null
    readUnavailable = false
    writes.length = 0
    probes.length = 0
    feedback.length = 0
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
    /** Polls under React act until the UI condition holds or its bounded deadline expires. */
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
/** Resolves a button by its visible label within the requested scope. */
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
async function selectRole(id: string, label: string) {
    await click(document.getElementById(id)!)
    await waitFor(() => document.querySelector('[role="option"]') !== null)
    const options = [...document.querySelectorAll('[role="option"]')]
    expect(options.some((option) => option.textContent?.trim() === 'Owner')).toBe(false)
    const option = options.find((entry) => entry.textContent?.includes(label))
    expect(option).toBeDefined()
    await click(option!)
    await click(document.getElementById(id)!)
}
function visible(account: AuthenticatedUser) {
    return getApplicationShellViewModel(account, (key) => key).navigationItems.some(
        (item) => item.to === '/identity-providers',
    )
}

describe('OIDC provider setup UI', () => {
    test('freezes unavailable roles and recovers from live invalidation without a refresh control', async () => {
        rolesUnavailable = true
        await render()
        await click(button('Edit provider'))
        expect((document.getElementById('oidc-provisioning') as HTMLInputElement).disabled).toBe(
            true,
        )
        expect((document.getElementById('oidc-default-roles') as HTMLButtonElement).disabled).toBe(
            true,
        )
        await click(button('Cancel', dialog()))
        rolesUnavailable = false
        await act(async () => {
            await client.invalidateQueries({ queryKey: ['admin', 'oidc-binding-roles'] })
        })
        expect(document.body.textContent).not.toContain('Refresh')
        await click(button('Edit provider'))
        await waitFor(
            () => !(document.getElementById('oidc-provisioning') as HTMLInputElement).disabled,
        )
        await fill('oidc-name', 'Catalog recovered')
        await submit()
        await waitFor(() => writes.length === 1 && !dialog())
        expect(writes[0]!.providers[0]).not.toHaveProperty('accountPolicy')
    })
    test('configures provisioning and exact group grants using existing nonowner roles', async () => {
        await render()
        await click(button('Edit provider'))
        expect((document.getElementById('oidc-provisioning') as HTMLInputElement).checked).toBe(
            false,
        )
        await click(document.getElementById('oidc-provisioning')!)
        await fill('oidc-group-claim', 'teams')
        await selectRole('oidc-default-roles', 'Member')
        await click(document.getElementById('oidc-add-mapping')!)
        await fill('oidc-group-0', 'Operators:EU')
        await selectRole('oidc-group-roles-0', 'Operator')
        await submit()
        await waitFor(() => writes.length === 1 && !dialog())
        expect(writes[0]!.providers[0]!.accountPolicy).toEqual({
            provisioning: true,
            groupClaim: 'teams',
            defaultRoleKeys: ['member'],
            groupRoleMappings: [{ group: 'Operators:EU', roleKeys: ['operator'] }],
        })
        expect(writes[0]!.providers[0]).not.toHaveProperty('clientSecret')
        expect(writes[0]!.expectedRevision).toBe(7)
        await click(button('Edit provider'))
        expect((document.getElementById('oidc-provisioning') as HTMLInputElement).checked).toBe(
            true,
        )
        expect((document.getElementById('oidc-group-0') as HTMLInputElement).value).toBe(
            'Operators:EU',
        )
    })
    test('preserves managed bindings and roles when provisioning is disabled and mapping rows are removed', async () => {
        snapshot.providers[0]!.accountPolicy = {
            provisioning: true,
            groupClaim: 'groups',
            defaultRoleKeys: ['member'],
            groupRoleMappings: [
                { group: 'Remove', roleKeys: ['member'] },
                { group: 'Keep', roleKeys: ['operator'] },
            ],
        }
        snapshot.providers[0]!.bindings = [
            { subject: 'managed-subject', userId, roleSource: 'provider', generation: 6 },
        ]
        await render()
        await click(button('Edit provider'))
        expect((document.getElementById('oidc-user-0') as HTMLButtonElement).disabled).toBe(true)
        await click(document.getElementById('oidc-provisioning')!)
        await click(document.getElementById('oidc-remove-mapping-0')!)
        await fill('oidc-group-0', 'Keep Exact Case')
        await click(document.getElementById('oidc-add-mapping')!)
        await fill('oidc-group-1', 'Extra')
        await selectRole('oidc-group-roles-1', 'Member')
        await submit()
        await waitFor(() => writes.length === 1 && !dialog())
        expect(writes[0]!.providers[0]!.accountPolicy).toEqual({
            provisioning: false,
            groupClaim: 'groups',
            defaultRoleKeys: ['member'],
            groupRoleMappings: [
                { group: 'Keep Exact Case', roleKeys: ['operator'] },
                { group: 'Extra', roleKeys: ['member'] },
            ],
        })
        expect(writes[0]!.providers[0]!.bindings).toEqual([
            { subject: 'managed-subject', userId, roleSource: 'provider', generation: 6 },
        ])
    })
    test('rejects duplicate exact group mappings before issuing any provider mutation', async () => {
        await render()
        await click(button('Edit provider'))
        await click(document.getElementById('oidc-add-mapping')!)
        await fill('oidc-group-0', 'Operators')
        await click(document.getElementById('oidc-add-mapping')!)
        await fill('oidc-group-1', 'Operators')
        await submit()
        await waitFor(() => feedback.some((item) => item.kind === 'error'))
        expect(writes).toHaveLength(0)
        expect(dialog()).not.toBeNull()
        expect((document.getElementById('oidc-group-0') as HTMLInputElement).value).toBe(
            'Operators',
        )
        await fill('oidc-group-1', 'operators')
        await submit()
        await waitFor(() => writes.length === 1 && !dialog())
        expect(
            writes[0]!.providers[0]!.accountPolicy!.groupRoleMappings.map(
                (mapping) => mapping.group,
            ),
        ).toEqual(['Operators', 'operators'])
    })
    test('unrelated edits leave old providers without account policy unchanged', async () => {
        await render()
        await click(button('Edit provider'))
        expect((document.getElementById('oidc-group-claim') as HTMLInputElement).value).toBe(
            'groups',
        )
        await fill('oidc-name', 'Legacy SSO')
        await submit()
        await waitFor(() => writes.length === 1 && !dialog())
        expect(writes[0]!.providers[0]).not.toHaveProperty('accountPolicy')
    })
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
    test('keeps saved cards through live reads and automatically adopts recovered query data', async () => {
        await render()
        const card = document.querySelector('article')!
        let release!: () => void
        pendingRead = new Promise((resolve) => {
            release = resolve
        })
        await act(async () => {
            void client.invalidateQueries({ queryKey: ['admin', 'oidc-providers'] })
        })
        expect(document.querySelector('article') === card).toBe(true)
        expect(document.querySelector('[role="status"]')).toBeNull()
        readUnavailable = true
        await act(async () => release())
        await waitFor(() => document.querySelector('[role="alert"]') !== null)
        expect(button('Add provider').disabled).toBe(true)
        expect(writes).toHaveLength(0)
        readUnavailable = false
        await act(async () => {
            await client.invalidateQueries({ queryKey: ['admin', 'oidc-providers'] })
        })
        await waitFor(() => !button('Add provider').disabled)
        expect(document.querySelector('article') === card).toBe(true)
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
    test('session expiry preserves the draft and reports sign-in failure without a credential dialog', async () => {
        await render()
        await click(button('Edit provider'))
        await fill('oidc-name', 'Draft after expiry')
        failure = 'authentication_required'
        await submit()
        await waitFor(() => feedback.some((item) => item.message === 'Sign in again.'))
        expect(document.getElementById('reauth-password')).toBeNull()
        expect((document.getElementById('oidc-name') as HTMLInputElement).value).toBe(
            'Draft after expiry',
        )
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
        expect(writes).toHaveLength(1)
        failure = null
        await submit()
        await waitFor(() => writes.length === 2 && !dialog())
        expect(writes[1]!.providers[0]!.name).toBe('Draft after expiry')
    })
    test('loads safe summaries, creates disabled providers, and closes only after a successful save', async () => {
        await render()
        const callback = document.getElementById('oidc-callback-url') as HTMLInputElement
        expect(callback.value).toBe(snapshot.callbackUrl!)
        expect(callback.readOnly).toBe(true)
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
        await fill('oidc-endpointOrigins', ' \t\n ')
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
    test('a conflict preserves the draft while latest data arrives and discard is local', async () => {
        await render()
        await click(button('Edit provider'))
        await fill('oidc-name', 'My unsaved name')
        snapshot = {
            ...snapshot,
            revision: 9,
            providers: snapshot.providers.map((provider) => ({
                ...provider,
                name: 'Remote name',
                revision: 9,
            })),
        }
        failure = 'configuration_conflict'
        await submit()
        await waitFor(() => feedback.some((item) => item.kind === 'error'))
        expect((document.getElementById('oidc-name') as HTMLInputElement).value).toBe(
            'My unsaved name',
        )
        expect(button('Save changes', dialog()).disabled).toBe(true)
        await submit()
        expect(writes).toHaveLength(1)
        failure = null
        await waitFor(
            () => document.querySelector('article')?.textContent?.includes('Remote name') === true,
        )
        expect((document.getElementById('oidc-name') as HTMLInputElement).value).toBe(
            'My unsaved name',
        )
        readUnavailable = true
        await click(button('Discard changes', dialog()))
        await waitFor(() => !button('Save changes', dialog()).disabled)
        expect((document.getElementById('oidc-name') as HTMLInputElement).value).toBe('Remote name')
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
        readUnavailable = false
        await fill('oidc-name', 'Explicit retry')
        await submit()
        await waitFor(() => writes.length === 2 && !dialog())
        expect(writes[1]!.expectedRevision).toBe(9)
    })
    test('a clean open editor follows new provider data without remounting its fields', async () => {
        await render()
        await click(button('Edit provider'))
        const input = document.getElementById('oidc-name') as HTMLInputElement
        snapshot = {
            ...snapshot,
            revision: 8,
            providers: snapshot.providers.map((provider) => ({
                ...provider,
                revision: 8,
                name: 'Live name',
            })),
        }
        await act(async () => {
            await client.invalidateQueries({ queryKey: ['admin', 'oidc-providers'] })
        })
        await waitFor(() => input.value === 'Live name')
        expect(document.getElementById('oidc-name')).toBe(input)
        expect(button('Save changes', dialog()).disabled).toBe(false)
    })
    test('unrelated provider changes update the save revision while retaining dirty fields', async () => {
        await render()
        await click(button('Edit provider'))
        await fill('oidc-name', 'My draft')
        snapshot = {
            ...snapshot,
            revision: 10,
            providers: [
                ...snapshot.providers,
                {
                    ...snapshot.providers[0]!,
                    id: '33333333-3333-4333-8333-333333333333',
                    name: 'Other provider',
                    revision: 10,
                },
            ],
        }
        await act(async () => {
            await client.invalidateQueries({ queryKey: ['admin', 'oidc-providers'] })
        })
        expect((document.getElementById('oidc-name') as HTMLInputElement).value).toBe('My draft')
        expect(button('Save changes', dialog()).disabled).toBe(false)
        await submit()
        await waitFor(() => writes.length === 1 && !dialog())
        expect(writes[0]!.expectedRevision).toBe(10)
        expect(writes[0]!.providers.map((provider) => provider.name)).toEqual([
            'Other provider',
            'My draft',
        ])
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

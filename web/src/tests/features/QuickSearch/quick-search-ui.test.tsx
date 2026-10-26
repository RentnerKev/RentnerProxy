import { afterEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type {
    QuickSearchEntity,
    QuickSearchInput,
} from '@/lib/QuickSearch/Types/quick-search.types.ts'
import { withLanguageRoot } from '@/tests/Helpers/withTestLanguage.tsx'
import QuickActionsProvider from '@/shared/QuickActions/Components/QuickActionsProvider.tsx'
import useQuickAction from '@/shared/QuickActions/Hooks/useQuickActions.ts'
import { useQuickActions } from '@/shared/QuickActions/Hooks/useQuickActions.ts'
import { QUICK_SEARCH_ACTIONS } from '@/config/quick-search.config.ts'
import type { QuickSearchActionId } from '@/lib/QuickSearch/Types/quick-search.types.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const emptyLookup = async (_input: { data: QuickSearchInput }): Promise<QuickSearchEntity[]> => []
const lookups = [mock(emptyLookup), mock(emptyLookup), mock(emptyLookup), mock(emptyLookup)]
for (const [index, [path, name]] of [
    ['ProxyHostManagement', 'searchProxyHostsHandler'],
    ['RedirectHostManagement', 'searchRedirectHostsHandler'],
    ['CertificateManagement', 'searchCertificatesHandler'],
    ['AccessPolicyManagement', 'searchAccessPoliciesHandler'],
].entries()) {
    mock.module(`@/features/Admin/${path}/middleware.ts`, () => ({ [name!]: lookups[index] }))
}

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterContextProvider,
    useRouterState,
} = await import('@tanstack/react-router')
const { default: QuickSearch } = await import('@/features/QuickSearch/index.tsx')
const { Modal } = await import('@/shared/Modal/index.tsx')
const { HotkeysProvider } = await import('@tanstack/react-hotkeys')

let root: Root | null = null
let client: QueryClient | null = null
const allPermissions = Object.values(PERMISSIONS)
const entities = [
    {
        id: '0198d98a-0000-7000-8000-000000000021',
        label: 'proxy.example.test',
        detail: 'http://upstream:80',
    },
    {
        id: '0198d98a-0000-7000-8000-000000000022',
        label: 'redirect.example.test',
        detail: 'https://example.test',
    },
    {
        id: '0198d98a-0000-7000-8000-000000000023',
        label: 'Example certificate',
        detail: '*.example.test',
    },
    { id: '0198d98a-0000-7000-8000-000000000024', label: 'Example policy', detail: 'Staff access' },
] satisfies QuickSearchEntity[]

function ActionTarget({
    id,
    ready,
}: {
    readonly id: QuickSearchActionId
    readonly ready: boolean
}) {
    const [open, setOpen] = useState(false)
    useQuickAction(id, () => setOpen(true), ready)
    return (
        <Modal
            open={open}
            onOpenChange={setOpen}
            title={`Opened ${id}`}
            description="Action target"
        >
            <input aria-label="Action field" />
        </Modal>
    )
}
function ActionTargets({ ready }: { readonly ready: boolean }) {
    const pathname = useRouterState({ select: (state) => state.location.pathname })
    const pending = useQuickActions()?.pending
    return (
        <>
            <output data-pending-action>{pending?.id}</output>
            {QUICK_SEARCH_ACTIONS.filter((action) => action.to === pathname).map((action) => (
                <ActionTarget key={action.id} id={action.id} ready={ready} />
            ))}
        </>
    )
}

async function mount(permissions: readonly string[] = allPermissions, platform?: 'mac') {
    const container = document.createElement('div')
    document.body.append(container)
    root = withLanguageRoot(createRoot(container))
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const routeRoot = createRootRoute()
    const router = createRouter({
        routeTree: routeRoot.addChildren(
            [
                '/',
                '/proxy-hosts',
                '/redirect-hosts',
                '/certificates',
                '/access-policies',
                '/account',
                '/providers',
                '/ddns',
                '/users',
                '/roles',
            ].map((path) => createRoute({ getParentRoute: () => routeRoot, path })),
        ),
        history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    const update = async (
        nextPermissions: readonly string[],
        userId = 'test-user',
        ready = true,
    ) => {
        await act(async () => {
            root?.render(
                <RouterContextProvider router={router}>
                    <QueryClientProvider client={client!}>
                        <HotkeysProvider defaultOptions={platform ? { hotkey: { platform } } : {}}>
                            <QuickActionsProvider key={userId} permissions={nextPermissions}>
                                <QuickSearch userId={userId} permissions={nextPermissions} />
                                <ActionTargets ready={ready} />
                            </QuickActionsProvider>
                        </HotkeysProvider>
                    </QueryClientProvider>
                </RouterContextProvider>,
            )
        })
    }
    await router.load()
    await update(permissions)
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
    return { container, trigger, router, update }
}

async function click(element: Element) {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Bun.sleep(10)
    })
}
async function key(
    target: Element,
    value: string,
    modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {},
) {
    const event = new KeyboardEvent('keydown', {
        key: value,
        bubbles: true,
        cancelable: true,
        ...modifiers,
    })
    await act(async () => {
        target.dispatchEvent(event)
        target.dispatchEvent(
            new KeyboardEvent('keyup', { key: value, bubbles: true, ...modifiers }),
        )
        await Bun.sleep(20)
    })
    await act(async () => {
        await Bun.sleep(20)
    })
    return event
}
function input() {
    return document.querySelector<HTMLInputElement>('[role="combobox"]')!
}
async function query(value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
            input(),
            value,
        )
        input().dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
        await Bun.sleep(260)
    })
    await act(async () => {
        await Bun.sleep(30)
    })
}
function selectedText() {
    return document.getElementById(input().getAttribute('aria-activedescendant')!)?.textContent
}

async function waitFor(condition: () => boolean, deadline = Date.now() + 2_000): Promise<void> {
    if (condition()) return
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the action modal')
    await act(async () => {
        await Bun.sleep(10)
    })
    await waitFor(condition, deadline)
}

afterEach(async () => {
    await act(async () => {
        root?.unmount()
        await Bun.sleep(10)
    })
    root = null
    client?.clear()
    client = null
    document.body.replaceChildren()
    for (const lookup of lookups) {
        lookup.mockReset()
        lookup.mockImplementation(emptyLookup)
    }
})

describe('global quick search', () => {
    test.each([
        ['create proxy', 'createProxyHost', '/proxy-hosts'],
        ['create redirect', 'createRedirectHost', '/redirect-hosts'],
        ['request acme', 'requestCertificate', '/certificates'],
        ['import pem', 'importCertificate', '/certificates'],
        ['import trusted ca', 'importTrustedCa', '/certificates'],
        ['create access policy', 'createAccessPolicy', '/access-policies'],
        ['create dns connection', 'createDnsConnection', '/providers'],
        ['create ddns record', 'createDdnsRecord', '/ddns'],
        ['create user', 'createUser', '/users'],
        ['create role', 'createRole', '/roles'],
    ])('opens %s through keyboard search after closing the palette', async (term, id, pathname) => {
        const { trigger, router } = await mount()
        trigger.focus()
        await click(trigger)
        await query(term!)
        await key(input(), 'Enter')
        expect(router.state.location.pathname).toBe(pathname)
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(`Opened ${id}`)
        expect(document.activeElement?.closest('[role="dialog"]')?.textContent).toContain(
            `Opened ${id}`,
        )
        expect(document.querySelector('[role="combobox"]')).toBeNull()
        await key(document.activeElement!, 'Escape')
        expect(document.querySelector('[role="dialog"]')).toBeNull()
        expect(document.activeElement === trigger).toBe(true)
    })
    test('reopens the same action on the current page and supports pointer selection', async () => {
        const { trigger } = await mount()
        const openAndClose = async () => {
            await click(trigger)
            await query('create proxy')
            await click(document.querySelector('[role="option"]')!)
            await waitFor(
                () =>
                    document
                        .querySelector('[role="dialog"]')
                        ?.textContent?.includes('Opened createProxyHost') === true,
            )
            expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
                'Opened createProxyHost',
            )
            await key(document.activeElement!, 'Escape')
        }
        await openAndClose()
        await openAndClose()
    })
    test('discards a queued action if permission is revoked before the target is ready', async () => {
        const { trigger, update } = await mount()
        await update(allPermissions, 'test-user', false)
        await click(trigger)
        await query('create proxy')
        await key(input(), 'Enter')
        await waitFor(
            () =>
                document.querySelector('[data-pending-action]')?.textContent === 'createProxyHost',
        )
        expect(document.querySelector('[role="dialog"]')).toBeNull()
        await update([PERMISSIONS.PROXY_HOSTS_VIEW])
        expect(document.querySelector('[role="dialog"]')).toBeNull()
        await update(allPermissions)
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    test.each(['user', 'route'] as const)(
        'discards a queued action after the %s changes',
        async (change) => {
            const { trigger, router, update } = await mount()
            await update(allPermissions, 'test-user', false)
            await click(trigger)
            await query('create proxy')
            await key(input(), 'Enter')
            await waitFor(
                () =>
                    document.querySelector('[data-pending-action]')?.textContent ===
                    'createProxyHost',
            )
            if (change === 'user') await update(allPermissions, 'other-user')
            else {
                await act(async () => {
                    await router.navigate({ to: '/' })
                    await Bun.sleep(20)
                })
                await act(async () => {
                    await router.navigate({ to: '/proxy-hosts' })
                    await Bun.sleep(20)
                })
                await update(allPermissions)
            }
            expect(document.querySelector('[role="dialog"]')).toBeNull()
            expect(document.querySelector('[data-pending-action]')?.textContent).toBe('')
        },
    )
    test('loads no entities at startup and opens/focuses/closes the same dialog by button or Ctrl+K', async () => {
        const { trigger } = await mount()
        for (const lookup of lookups) expect(lookup).not.toHaveBeenCalled()
        trigger.focus()
        await click(trigger)
        expect(document.activeElement === input()).toBe(true)
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Quick search')
        expect(input().getAttribute('aria-controls')).toBe(
            document.querySelector('[role="listbox"]')!.id,
        )
        await key(input(), 'Escape')
        expect(document.querySelector('[role="dialog"]')).toBeNull()
        expect(document.activeElement === trigger).toBe(true)
        const event = await key(trigger, 'k', { ctrlKey: true })
        expect(event.defaultPrevented).toBe(true)
        expect(document.activeElement === input()).toBe(true)
        for (const lookup of lookups) expect(lookup).not.toHaveBeenCalled()
    })

    test('cold-open arrow keys and Enter navigate before typing any query', async () => {
        const { trigger, router } = await mount([PERMISSIONS.PROXY_HOSTS_VIEW])
        trigger.focus()
        await click(trigger)
        expect(selectedText()).toContain('Overview')
        await key(input(), 'ArrowDown')
        expect(selectedText()).toContain('Proxy hosts')
        await key(input(), 'Enter')
        expect(router.state.location.pathname).toBe('/proxy-hosts')
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })

    test('Cmd+K works through the TanStack macOS binding', async () => {
        const { trigger } = await mount([], 'mac')
        trigger.focus()
        const event = await key(trigger, 'k', { metaKey: true })
        expect(event.defaultPrevented).toBe(true)
        expect(document.activeElement === input()).toBe(true)
    })

    test('opens the existing account setting directly without loading entities', async () => {
        const { trigger, router } = await mount([PERMISSIONS.ACCOUNT_VIEW])
        await click(trigger)
        await query('language')
        expect(selectedText()).toContain('Language')
        await key(input(), 'Enter')
        expect(router.state.location.pathname).toBe('/account')
        expect(router.state.location.search).toMatchObject({ section: 'language' })
        for (const lookup of lookups) expect(lookup).not.toHaveBeenCalled()
    })

    test.each(['input', 'textarea', 'div'])('leaves an editing %s untouched', async (tag) => {
        await mount()
        const editor = document.createElement(tag)
        if (tag === 'div') editor.contentEditable = 'true'
        document.body.append(editor)
        const event = await key(editor, 'k', { ctrlKey: true })
        expect(event.defaultPrevented).toBe(false)
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })

    test('leaves unrelated dialogs untouched', async () => {
        await mount()
        const otherDialog = document.createElement('div')
        otherDialog.setAttribute('role', 'dialog')
        otherDialog.dataset.state = 'open'
        document.body.append(otherDialog)
        const event = await key(document.body, 'k', { ctrlKey: true })
        expect(event.defaultPrevented).toBe(false)
        expect(document.querySelector('[role="combobox"]')).toBeNull()
    })

    test('searches every allowed category and confirms an exact target before keyboard navigation', async () => {
        for (const [index, lookup] of lookups.entries())
            lookup.mockImplementation(async () => [entities[index]!])
        const { trigger, router } = await mount()
        await click(trigger)
        await query('example.test')
        expect(document.querySelectorAll('[role="option"]')).toHaveLength(4)
        for (const lookup of lookups)
            expect(lookup).toHaveBeenCalledWith({ data: { query: 'example.test' } })
        expect(selectedText()).toContain('proxy.example.test')
        await key(input(), 'ArrowDown')
        expect(selectedText()).toContain('redirect.example.test')
        await key(input(), 'Enter')
        expect(lookups[1]).toHaveBeenLastCalledWith({
            data: { query: 'example.test', id: entities[1]!.id },
        })
        expect(router.state.location.pathname).toBe('/redirect-hosts')
    })

    test('bounds results, hides unauthorized categories and shows unavailable data with a working retry', async () => {
        lookups[0]!.mockImplementation(async () =>
            Array.from({ length: 12 }, (_, index) => ({ ...entities[0]!, id: String(index) })),
        )
        lookups[2]!.mockImplementation(async () => {
            throw new Error('private backend failure')
        })
        const { trigger } = await mount([
            PERMISSIONS.PROXY_HOSTS_VIEW,
            PERMISSIONS.CERTIFICATES_VIEW,
        ])
        await click(trigger)
        await query('x')
        for (const lookup of lookups) expect(lookup).not.toHaveBeenCalled()
        await query('example.test')
        expect(document.querySelectorAll('[role="option"]')).toHaveLength(6)
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
            'Some results are unavailable',
        )
        expect(document.body.textContent).not.toContain('private backend failure')
        expect(lookups[1]).not.toHaveBeenCalled()
        expect(lookups[3]).not.toHaveBeenCalled()
        lookups[2]!.mockImplementation(async () => [entities[2]!])
        await click(
            [...document.querySelectorAll('button')].find(
                (button) => button.textContent === 'Retry search',
            )!,
        )
        await act(async () => {
            await Bun.sleep(20)
        })
        expect(document.querySelectorAll('[role="option"]')).toHaveLength(7)
        expect(document.body.textContent).not.toContain('Some results are unavailable')
    })

    test('retains the query and reports a deleted or forbidden target without navigating', async () => {
        lookups[0]!.mockImplementation(async ({ data }) => (data.id ? [] : [entities[0]!]))
        const { trigger, router } = await mount([PERMISSIONS.PROXY_HOSTS_VIEW])
        await click(trigger)
        await query('example.test')
        await key(input(), 'Enter')
        expect(router.state.location.pathname).toBe('/')
        expect(input().value).toBe('example.test')
        expect(document.body.textContent).toContain('This entry is no longer available')
    })

    test('discards stale data and an in-flight selection when permissions change', async () => {
        let resolveSelection: ((value: QuickSearchEntity[]) => void) | undefined
        lookups[0]!.mockImplementation(async ({ data }) =>
            data.id
                ? new Promise((resolve) => {
                      resolveSelection = resolve
                  })
                : [entities[0]!],
        )
        const { trigger, router, update } = await mount([PERMISSIONS.PROXY_HOSTS_VIEW])
        await click(trigger)
        await query('example.test')
        await key(input(), 'Enter')
        expect(resolveSelection).toBeDefined()
        await update([])
        expect(document.body.textContent).not.toContain('proxy.example.test')
        await act(async () => {
            resolveSelection?.([entities[0]!])
            await Bun.sleep(20)
        })
        expect(router.state.location.pathname).toBe('/')
        expect(document.body.textContent).not.toContain('proxy.example.test')
        expect(document.body.textContent).toContain('No results found')
    })

    test('shows loading and empty states and clears prior result data on close', async () => {
        let resolveQuery: ((value: QuickSearchEntity[]) => void) | undefined
        lookups[0]!.mockImplementation(
            async () =>
                new Promise((resolve) => {
                    resolveQuery = resolve
                }),
        )
        const { trigger } = await mount([PERMISSIONS.PROXY_HOSTS_VIEW])
        await click(trigger)
        await query('unmatched')
        expect(document.body.textContent).toContain('Searching…')
        await act(async () => {
            resolveQuery?.([])
            await Bun.sleep(20)
        })
        expect(document.body.textContent).toContain('No results found')
        await key(input(), 'Escape')
        expect(
            client
                ?.getQueryCache()
                .findAll({ queryKey: ['quick-search'] })
                .every((entry) => entry.state.data === undefined),
        ).toBe(true)
    })

    test('does not expose a late query response after the user changes', async () => {
        let resolveQuery: ((value: QuickSearchEntity[]) => void) | undefined
        lookups[0]!.mockImplementation(
            async () =>
                new Promise((resolve) => {
                    resolveQuery = resolve
                }),
        )
        const { trigger, update } = await mount([PERMISSIONS.PROXY_HOSTS_VIEW])
        await click(trigger)
        await query('example.test')
        expect(resolveQuery).toBeDefined()
        await update([], 'different-user')
        await act(async () => {
            resolveQuery?.([entities[0]!])
            await Bun.sleep(30)
        })
        expect(document.body.textContent).not.toContain('proxy.example.test')
        expect(document.body.textContent).not.toContain('Proxy hosts')
    })
})

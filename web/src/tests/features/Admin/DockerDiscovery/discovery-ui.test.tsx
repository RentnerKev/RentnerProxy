// oxlint-disable no-map-spread -- Immutable snapshots model updates received over the live channel.
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { DOCKER_DISCOVERY_QUERY_KEY } from '@/config/docker-discovery.config.ts'
import { dockerDiscoveryIssues } from '@/lib/DockerDiscovery/validation.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { DiscoveryOverview } from '@/lib/DockerDiscovery/Types/management.types.ts'
import type { DiscoveryApi } from '@/features/Admin/DockerDiscovery/Types/discovery-ui.types.ts'
import {
    discoveryCandidate,
    discoveryOverview,
    DISCOVERY_HOST,
} from '@/tests/Helpers/discoveryFixture.ts'
import withTestLanguage, { catalogs } from '@/tests/Helpers/withTestLanguage.tsx'
import getApplicationShellViewModel from '@/lib/ApplicationShell/applicationShell.ts'
import { getProxyHostTableActionItems } from '@/lib/Admin/ProxyHostManagement/proxyHostTableActions.ts'
import { discoveredHost } from '@/tests/Helpers/discoveryFixture.ts'

if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register({ settings: { device: { prefersReducedMotion: 'reduce' } } })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { toast } = await import('@rentnerkev/toasts')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterContextProvider } =
    await import('@tanstack/react-router')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: DockerDiscoveryPage } = await import('@/features/Admin/DockerDiscovery/index.tsx')
let root: Root | undefined
let client: InstanceType<typeof QueryClient>
const feedback: { kind: string; message: unknown }[] = []
let restoreToasts: (() => void)[] = []
const view = [PERMISSIONS.DOCKER_DISCOVERY_VIEW, PERMISSIONS.PROXY_HOSTS_VIEW]
const allPermissions = Object.values(PERMISSIONS)
const noop = () => {}
function leaves(value: object, prefix = ''): Record<string, string> {
    return Object.fromEntries(
        Object.entries(value).flatMap(([key, child]) =>
            typeof child === 'object'
                ? Object.entries(leaves(child, `${prefix}${key}.`))
                : [[`${prefix}${key}`, child]],
        ),
    )
}

beforeEach(() => {
    feedback.length = 0
    restoreToasts = (['error', 'success', 'info'] as const).map((kind) => {
        const spy = spyOn(toast, kind).mockImplementation((message) => {
            feedback.push({ kind, message })
            return 'fixture-toast'
        })
        return () => spy.mockRestore()
    })
})
afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    client?.clear()
    document.body.replaceChildren()
    restoreToasts.forEach((restore) => restore())
})
function fixture(initial = discoveryOverview()) {
    let overview = structuredClone(initial)
    const api: DiscoveryApi = {
        status: mock(async () => structuredClone(overview)),
        inspect: mock(async () => ({ candidates: overview.snapshot?.candidates ?? [] })),
        connect: mock(async (input: Parameters<DiscoveryApi['connect']>[0]) => {
            overview = {
                ...overview,
                management: {
                    ...overview.management,
                    revision: overview.management.revision + 1,
                    enabled: false,
                    connectorRevision: input.connectorRevision + 1,
                },
                snapshot: {
                    ...overview.snapshot!,
                    status: 'ready',
                    stale: false,
                    configuration: {
                        version: 1,
                        revision: input.connectorRevision + 1,
                        settings: { enabled: true, endpoint: input.endpoint },
                    },
                },
            }
            return { revision: overview.management.revision }
        }),
        change: mock(async (input: Parameters<DiscoveryApi['change']>[0]) => {
            overview = {
                ...overview,
                management: { ...overview.management, revision: input.expectedRevision + 1 },
            }
            if (input.action === 'enable' || input.action === 'disable')
                overview = {
                    ...overview,
                    management: { ...overview.management, enabled: input.action === 'enable' },
                }
            if (input.action === 'detach')
                overview = {
                    ...overview,
                    rows: overview.rows.map((row) =>
                        row.key === input.key ? { ...row, state: 'detached' as const } : row,
                    ),
                }
            if (input.action === 'disconnect')
                overview = {
                    ...overview,
                    management: { ...overview.management, enabled: false },
                    snapshot: {
                        ...overview.snapshot!,
                        status: 'disabled',
                        configuration: {
                            ...overview.snapshot!.configuration,
                            settings: {
                                ...overview.snapshot!.configuration.settings,
                                enabled: false,
                            },
                        },
                    },
                }
            return { revision: overview.management.revision }
        }),
    }
    return {
        api,
        set: (value: DiscoveryOverview) => {
            overview = value
        },
    }
}
async function waitFor(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 3000
    async function poll(): Promise<void> {
        if (condition()) return
        if (Date.now() > deadline)
            throw new Error(`Discovery UI timeout: ${document.body.textContent?.slice(-700)}`)
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
        await poll()
    }
    await poll()
}
async function render(api: DiscoveryApi, permissions: readonly PermissionKey[] = allPermissions) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const route = createRootRoute()
    const router = createRouter({
        routeTree: route.addChildren([
            createRoute({ getParentRoute: () => route, path: '/proxy-hosts' }),
        ]),
        history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await act(async () =>
        root!.render(
            withTestLanguage(
                <QueryClientProvider client={client}>
                    <RouterContextProvider router={router}>
                        <DockerDiscoveryPage
                            api={api}
                            permissions={permissions}
                            liveEnabled={false}
                        />
                    </RouterContextProvider>
                </QueryClientProvider>,
            ),
        ),
    )
    if (view.every((key) => permissions.includes(key)))
        await waitFor(
            () =>
                client.getQueryState(DOCKER_DISCOVERY_QUERY_KEY)?.status !== 'pending' &&
                !document.querySelector('tbody[aria-busy="true"]'),
        )
}
function button(label: string, scope: ParentNode = document): HTMLButtonElement {
    const item = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
        (element) => element.textContent?.trim() === label,
    )
    if (!item) throw new Error(`Missing button: ${label}`)
    return item
}
function topDialog(): HTMLElement {
    const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)
    if (!dialog) throw new Error('Missing dialog')
    return dialog
}
async function click(element: Element) {
    await act(async () =>
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    )
}
async function fill(element: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
            element,
            value,
        )
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
    })
}
async function submit() {
    await act(async () =>
        document
            .querySelector('form')!
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
}
async function action(label: string, name = 'compose:example/app') {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
    })
    const trigger = document.querySelector(`button[aria-label="Actions for ${name}"]`)!
    await act(async () =>
        trigger.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
        ),
    )
    await waitFor(() => !!document.querySelector('[role="menuitem"]'))
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
        (element) => element.textContent?.trim() === label,
    )
    if (!item) throw new Error(`Missing action: ${label}`)
    await click(item)
}
async function live(value: DiscoveryOverview, set: (value: DiscoveryOverview) => void) {
    set(value)
    await act(async () => {
        client.setQueryData(DOCKER_DISCOVERY_QUERY_KEY, value)
        await new Promise((resolve) => setTimeout(resolve, 10))
    })
}

describe('Docker discovery management UI', () => {
    test('renders conflicting identities independently and supports search plus row status filters', async () => {
        const candidates = [
            discoveryCandidate(),
            discoveryCandidate({
                containerId: 'b'.repeat(64),
                sourceId: 'name:stopped',
                domains: ['stopped.example.com'],
            }),
            discoveryCandidate({ containerId: 'd'.repeat(64) }),
        ]
        const initial = discoveryOverview(candidates)
        const overview = {
            ...initial,
            rows: initial.rows.map((row, index) => ({
                ...row,
                key: index === 2 ? initial.rows[0]!.key : row.key,
                state: index === 1 ? ('stopped' as const) : ('conflicted' as const),
                issues: index === 1 ? ['container_not_running'] : ['source_conflict'],
            })),
        }
        await render(fixture(overview).api)
        await waitFor(() => document.querySelectorAll('tbody tr').length === 3)
        await click(document.querySelector('button[aria-label="Filters"]')!)
        const filter = document.querySelector('[role="combobox"][aria-label="Filter Status…"]')!
        expect(filter).not.toBeNull()
        await click(filter)
        await waitFor(
            () =>
                !![...document.querySelectorAll('[role="option"]')].find(
                    (element) => element.textContent?.trim() === 'Container stopped',
                ),
        )
        await click(
            [...document.querySelectorAll('[role="option"]')].find(
                (element) => element.textContent?.trim() === 'Container stopped',
            )!,
        )
        await waitFor(() => document.querySelectorAll('tbody tr').length === 1)
        expect(document.querySelector('tbody')?.textContent).toContain('stopped.example.com')
        await fill(document.querySelector('input[type="search"]')!, 'does-not-exist')
        await waitFor(() => document.body.textContent?.includes('No matching sources') === true)
    })
    test('requires paired view rights and keeps read-only users out of mutations', async () => {
        const f = fixture()
        await render(f.api, [PERMISSIONS.DOCKER_DISCOVERY_VIEW])
        expect(f.api.status).not.toHaveBeenCalled()
        expect(document.body.textContent).not.toContain('app.example.com')
        expect(
            getApplicationShellViewModel(
                { permissions: [PERMISSIONS.DOCKER_DISCOVERY_VIEW] },
                (key) => key,
            ).navigationItems.some((item) => item.to === '/docker-discovery'),
        ).toBe(false)
        await act(async () => root?.unmount())
        root = undefined
        await render(f.api, view)
        expect(document.body.textContent).toContain('app.example.com')
        expect(document.body.textContent).not.toContain('Enable synchronization')
        expect(
            [...document.querySelectorAll('button')].some(
                (item) => item.textContent?.trim() === 'Connection',
            ),
        ).toBe(false)
        await action('Source details')
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Will create host')
        expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
            'Detach from discovery',
        )
    })
    test('keeps connection status and synchronization controls inside the connection modal', async () => {
        const initial = discoveryOverview()
        const f = fixture(initial)
        await render(f.api)
        expect(document.querySelector('output')).toBeNull()
        expect(document.body.textContent).not.toContain('Docker connection')
        expect(document.body.textContent).not.toContain('Enable synchronization')
        expect(document.body.textContent).not.toContain('Review the candidates below')
        expect(document.querySelector('tbody')?.textContent).toContain('app.example.com')
        await click(button('Connection'))
        const dialog = topDialog()
        expect(dialog.querySelector('output')?.textContent).toBe('Connected')
        expect(button('Enable synchronization', dialog).disabled).toBe(false)
        await live(
            {
                ...initial,
                snapshot: { ...initial.snapshot!, status: 'unavailable', stale: true },
            },
            f.set,
        )
        expect(dialog.querySelector('output')?.textContent).toBe('Unavailable')
        expect(button('Enable synchronization', dialog).disabled).toBe(true)
        await click(button('Cancel', dialog))
        expect(document.querySelector('[role="dialog"]')).toBeNull()
        expect(f.api.change).not.toHaveBeenCalled()
        expect(f.api.connect).not.toHaveBeenCalled()
    })
    test('does not activate the saved endpoint while another endpoint is being edited or tested', async () => {
        const f = fixture()
        await render(f.api)
        await click(button('Connection'))
        const input = document.querySelector<HTMLInputElement>('input[name="endpoint"]')!
        const savedEndpoint = input.value
        await fill(input, 'http://different-docker:2375')
        expect(button('Enable synchronization').disabled).toBe(true)
        await click(button('Test connection'))
        await waitFor(() => !button('Save changes').disabled)
        expect(button('Enable synchronization').disabled).toBe(true)
        expect(f.api.change).not.toHaveBeenCalled()
        expect(f.api.connect).not.toHaveBeenCalled()
        await fill(input, savedEndpoint)
        expect(button('Enable synchronization').disabled).toBe(false)
        await click(button('Cancel'))
        expect(f.api.change).not.toHaveBeenCalled()
        expect(f.api.connect).not.toHaveBeenCalled()
    })
    test('tests an endpoint before saving, invalidates a changed test and confirms restored reads', async () => {
        const initial = discoveryOverview()
        const f = fixture({ ...initial, snapshot: { ...initial.snapshot!, status: 'paused' } })
        await render(f.api)
        await click(button('Connection'))
        const input = document.querySelector<HTMLInputElement>('input[name="endpoint"]')!
        const save = button('Save changes')
        expect(save.disabled).toBe(true)
        await fill(input, 'http://127.0.0.1:2375')
        await click(button('Test connection'))
        expect(f.api.inspect).toHaveBeenCalledWith({ endpoint: 'http://127.0.0.1:2375' })
        expect(save.disabled).toBe(true)
        await click(document.querySelector('input[name="acknowledgeRestore"]')!)
        await waitFor(() => !save.disabled)
        await fill(input, 'http://127.0.0.1:2376')
        expect(save.disabled).toBe(true)
        await click(button('Test connection'))
        await waitFor(() => !save.disabled)
        await submit()
        await waitFor(() => !document.querySelector('[role="dialog"]'))
        expect(f.api.connect).toHaveBeenCalledWith({
            endpoint: 'http://127.0.0.1:2376',
            acknowledgeRestore: true,
            connectorRevision: 1,
            expectedRevision: 0,
        })
        expect(f.api.change).not.toHaveBeenCalled()
        expect(
            feedback.some(
                (item) =>
                    item.kind === 'success' && String(item.message).includes('Connection saved'),
            ),
        ).toBe(true)
    })
    test('uses sanitized toast errors and never starts a request for an invalid endpoint', async () => {
        const f = fixture()
        f.api.inspect = mock(async () => {
            throw new Error('SYNTHETIC_PRIVATE_BACKEND_VALUE')
        })
        await render(f.api)
        await click(button('Connection'))
        const input = document.querySelector<HTMLInputElement>('input[name="endpoint"]')!
        await fill(input, 'http://user:secret@docker:2375')
        await click(button('Test connection'))
        expect(f.api.inspect).not.toHaveBeenCalled()
        expect(feedback.some((item) => item.kind === 'error')).toBe(true)
        await fill(input, 'http://docker:2375')
        await click(button('Test connection'))
        expect(f.api.inspect).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(feedback)).not.toContain('PRIVATE')
        expect(document.body.textContent).not.toContain('could not complete')
        expect(button('Save changes').disabled).toBe(true)
    })
    test('rejects saving after another session changes the connector revision', async () => {
        const initial = discoveryOverview()
        const f = fixture(initial)
        await render(f.api)
        await click(button('Connection'))
        await click(button('Test connection'))
        await live(
            {
                ...initial,
                snapshot: {
                    ...initial.snapshot!,
                    configuration: { ...initial.snapshot!.configuration, revision: 2 },
                },
            },
            f.set,
        )
        await submit()
        expect(f.api.connect).not.toHaveBeenCalled()
        expect(
            feedback.some(
                (item) => item.kind === 'info' && String(item.message).includes('source changed'),
            ),
        ).toBe(true)
    })
    test('shows the activation preview and refuses a changed plan before mutation', async () => {
        const initial = discoveryOverview()
        const f = fixture(initial)
        await render(f.api)
        await click(button('Connection'))
        await click(button('Enable synchronization'))
        const dialog = topDialog()
        expect(dialog.textContent).toContain('1 hosts will be created and 0 updated')
        await live({ ...initial, previewToken: 'd'.repeat(64) }, f.set)
        await click(button('Enable synchronization', dialog))
        expect(f.api.change).not.toHaveBeenCalled()
        await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 1)
        await click(button('Enable synchronization'))
        await click(button('Enable synchronization', topDialog()))
        await waitFor(
            () =>
                f.api.change !== undefined &&
                document.body.textContent?.includes('Pause synchronization') === true,
        )
        expect(f.api.change).toHaveBeenCalledWith({
            expectedRevision: 0,
            action: 'enable',
            previewToken: 'd'.repeat(64),
        })
        await click(button('Pause synchronization'))
        await waitFor(() => document.body.textContent?.includes('Enable synchronization') === true)
        expect(document.body.textContent).toContain('app.example.com')
        expect(f.api.change).toHaveBeenCalledTimes(2)
    })
    test('ignores repeated activation clicks while the first request is pending', async () => {
        const f = fixture()
        let release!: () => void
        const pending = new Promise<void>((resolve) => {
            release = resolve
        })
        f.api.change = mock(async () => {
            await pending
            return { revision: 1 }
        })
        await render(f.api)
        await click(button('Connection'))
        await click(button('Enable synchronization'))
        const confirm = button('Enable synchronization', topDialog())
        await click(confirm)
        await click(confirm)
        expect(f.api.change).toHaveBeenCalledTimes(1)
        await act(async () => {
            release()
            await pending
        })
        await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 1)
    })
    test('detaches only after confirmation and retains the host as manually managed', async () => {
        const initial = discoveryOverview()
        const f = fixture({
            ...initial,
            rows: [
                { ...initial.rows[0]!, hostId: DISCOVERY_HOST, state: 'orphaned', target: null },
            ],
        })
        await render(f.api)
        await action('Detach from discovery')
        const dialog = document.querySelector('[role="dialog"]')!
        expect(dialog.textContent).toContain('keeps its configuration and certificate')
        expect(f.api.change).not.toHaveBeenCalled()
        await click(button('Detach from discovery', dialog))
        await waitFor(
            () =>
                document.querySelector('tbody')?.textContent?.includes('Manually managed') === true,
        )
        expect(f.api.change).toHaveBeenCalledWith({
            expectedRevision: 0,
            action: 'detach',
            key: initial.rows[0]!.key,
        })
        expect(document.body.textContent).toContain('app.example.com')
    })
    test('blocks a stale detach and shows unavailable details after live source removal', async () => {
        const initial = discoveryOverview()
        const f = fixture({ ...initial, rows: [{ ...initial.rows[0]!, hostId: DISCOVERY_HOST }] })
        await render(f.api)
        await action('Detach from discovery')
        await live(
            {
                ...initial,
                management: { ...initial.management, revision: 1 },
                rows: [{ ...initial.rows[0]!, hostId: DISCOVERY_HOST }],
            },
            f.set,
        )
        await click(button('Detach from discovery', document.querySelector('[role="dialog"]')!))
        expect(f.api.change).not.toHaveBeenCalled()
        await waitFor(() => !document.querySelector('[role="dialog"]'))
        await action('Source details')
        await live({ ...initial, rows: [] }, f.set)
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
            'Source unavailable',
        )
    })
    test('can disconnect while retaining rows and retries only with the required grants', async () => {
        const initial = discoveryOverview()
        const f = fixture({
            ...initial,
            snapshot: { ...initial.snapshot!, status: 'unavailable', stale: true },
            rows: [{ ...initial.rows[0]!, state: 'unavailable' }],
        })
        await render(f.api)
        await click(button('Connection'))
        await click(button('Retry synchronization'))
        await waitFor(() => f.api.change !== undefined && !button('Connection').disabled)
        expect(f.api.change).toHaveBeenCalledWith({ expectedRevision: 0, action: 'retry' })
        await click(button('Disable connection'))
        await waitFor(() => !document.querySelector('[role="dialog"]'))
        expect(f.api.change).toHaveBeenCalledWith({ expectedRevision: 1, action: 'disconnect' })
        await click(button('Connection'))
        expect(document.body.textContent).toContain('Disconnected')
        expect(document.body.textContent).toContain('app.example.com')
    })
    test('reports a failed read once and recovers through cache updates without a reload button', async () => {
        const f = fixture()
        f.api.status = mock(async () => {
            throw new Error('private backend response')
        })
        await render(f.api)
        await waitFor(() => feedback.some((item) => item.kind === 'error'))
        await act(async () => {
            await client.refetchQueries({ queryKey: DOCKER_DISCOVERY_QUERY_KEY })
        })
        expect(feedback.filter((item) => item.kind === 'error')).toHaveLength(1)
        expect(button('Connection').disabled).toBe(true)
        await live(discoveryOverview(), f.set)
        expect(button('Connection').disabled).toBe(false)
        expect(document.body.textContent).toContain('app.example.com')
        expect(
            [...document.querySelectorAll('button')].some((item) =>
                /reload|refresh/iu.test(item.textContent ?? ''),
            ),
        ).toBe(false)
    })
    test('explains label-managed hosts and excludes edit, deletion and certificate mutation actions', () => {
        const actions = getProxyHostTableActionItems(
            {
                host: discoveredHost({ discovery: { state: 'managed' } }),
                canDelete: true,
                canDisable: true,
                canEnable: true,
                canUpdate: true,
                canRequestCertificate: true,
                isPending: false,
                onDelete: noop,
                onDisable: noop,
                onEnable: noop,
                onEdit: noop,
                onConfig: noop,
                onRequestCertificate: noop,
            },
            (key) => key,
        )
        expect(actions.map((item) => item.label)).toEqual([
            'admin.proxyHosts.actions.config',
            'admin.proxyHosts.actions.disable',
        ])
    })
    test('connector managers without host mutation rights cannot activate, retry active sync or detach', async () => {
        const initial = discoveryOverview()
        const f = fixture({
            ...initial,
            management: { ...initial.management, enabled: true, error: 'reconcile_failed' },
            snapshot: { ...initial.snapshot!, status: 'unavailable', stale: true },
            rows: [{ ...initial.rows[0]!, hostId: DISCOVERY_HOST }],
        })
        await render(f.api, [...view, PERMISSIONS.DOCKER_DISCOVERY_MANAGE])
        await action('Source details')
        expect(document.body.textContent).not.toContain('Detach from discovery')
        await click(document.querySelector('button[aria-label="Close dialog"]')!)
        await click(button('Connection'))
        expect(document.body.textContent).not.toContain('Retry synchronization')
        expect(button('Pause synchronization').disabled).toBe(false)
        await click(button('Pause synchronization'))
        await waitFor(() => document.body.textContent?.includes('Enable synchronization') === true)
        expect(button('Enable synchronization').disabled).toBe(true)
        expect(f.api.change).toHaveBeenCalledWith({ expectedRevision: 0, action: 'disable' })
    })
    test('shows a compact quick start, switches environments and copies only the selected example values', async () => {
        await render(fixture().api)
        const clipboard = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
        try {
            await click(button('Compose example'))
            const dialog = document.querySelector('[role="dialog"]')!
            expect(button('Local development', dialog).getAttribute('aria-pressed')).toBe('true')
            expect(dialog.textContent).toContain('unix:///var/run/docker.sock')
            expect(dialog.textContent).not.toContain('127.0.0.1:2375')
            expect(dialog.textContent).toContain('rentnerproxy.enable: "true"')
            expect(dialog.querySelectorAll('ol > li')).toHaveLength(3)
            expect([...dialog.querySelectorAll('details')].every((details) => !details.open)).toBe(
                true,
            )
            await click(button('Copy Compose file', dialog))
            expect(clipboard.mock.calls[0]?.[0]).toContain('  example-app:')
            expect(clipboard.mock.calls[0]?.[0]).not.toContain('ports:')
            expect(clipboard.mock.calls[0]?.[0]).not.toContain('docker-api:')
            expect(clipboard.mock.calls[0]?.[0]).not.toContain('/var/run/docker.sock:')
            await click(dialog.querySelector('button[aria-label="Copy start command"]')!)
            expect(clipboard.mock.calls[1]?.[0]).toBe(
                'docker compose -f docker-discovery.dev.yml up -d',
            )
            await click(dialog.querySelector('button[aria-label="Copy endpoint"]')!)
            expect(clipboard.mock.calls[2]?.[0]).toBe('unix:///var/run/docker.sock')
            await click(button('Docker appliance', dialog))
            expect(button('Docker appliance', dialog).getAttribute('aria-pressed')).toBe('true')
            expect(dialog.textContent).not.toContain('127.0.0.1:2375')
            await click(dialog.querySelector('button[aria-label="Copy endpoint"]')!)
            expect(clipboard.mock.calls[3]?.[0]).toBe('http://docker-api:2375')
            clipboard.mockRejectedValue(new Error('Clipboard denied'))
            await click(button('Copy Compose file', dialog))
            await waitFor(() =>
                feedback.some(
                    (item) => item.kind === 'error' && String(item.message).includes('Copy failed'),
                ),
            )
            expect(clipboard).toHaveBeenCalledTimes(5)
            expect(clipboard.mock.calls[4]?.[0]).toContain(
                'networks: [default, proxy, discovery-control]',
            )
        } finally {
            clipboard.mockRestore()
        }
    })
    test('provides every discovery translation in all supported languages', () => {
        const english = leaves(catalogs.en.admin.dockerDiscovery)
        for (const catalog of Object.values(catalogs)) {
            const translated = leaves(catalog.admin.dockerDiscovery)
            expect(Object.keys(translated).toSorted()).toEqual(Object.keys(english).toSorted())
            expect(
                Object.values(translated).every(
                    (value) => typeof value === 'string' && value.length > 0,
                ),
            ).toBe(true)
            expect(catalog.shell.dockerDiscovery).toBeTruthy()
            for (const issue of dockerDiscoveryIssues)
                expect(translated[`issues.${issue}`]).toBeTruthy()
        }
    })
})

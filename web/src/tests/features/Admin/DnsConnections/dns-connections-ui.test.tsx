import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type {
    CloudflareZone,
    DnsConnection,
} from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'
import type {
    SaveDnsConnectionInput,
    TestDnsConnectionInput,
} from '@/features/Admin/DnsConnections/Types/validation.types.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()

const firstZone = { id: 'a'.repeat(32), name: 'one.example' }
const secondZone = { id: 'b'.repeat(32), name: 'two.example' }
const connection: DnsConnection = {
    id: '01900000-0000-7000-8000-000000000001',
    provider: 'cloudflare',
    ownership: 'instance',
    name: 'Office Cloudflare',
    createdByUserId: '01900000-0000-7000-8000-000000000002',
    revision: 3,
    zones: [firstZone],
    references: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
}
let connections: readonly DnsConnection[] = []
let queryFails = false
let testFails = false
let saveFails = false
let availableZones: readonly CloudflareZone[] = [firstZone, secondZone]
const getConnections = mock(async () => {
    if (queryFails) throw new Error('offline')
    return connections
})
const testConnection = mock(async (_input: { data: TestDnsConnectionInput }) =>
    testFails
        ? { success: false as const, message: 'admin.dnsConnections.errors.provider_unauthorized' }
        : {
              success: true as const,
              message: 'admin.dnsConnections.messages.tested',
              result: {
                  zones: availableZones,
                  selectedZoneIds: [],
                  checkedAt: '2026-10-01T00:00:00Z',
                  dnsWriteVerified: false as const,
              },
          },
)
const saveConnection = mock(async (_input: { data: SaveDnsConnectionInput }) =>
    saveFails
        ? { success: false as const, message: 'admin.dnsConnections.errors.connection_conflict' }
        : { success: true as const, message: 'admin.dnsConnections.messages.saved', connection },
)
const deleteConnection = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.dnsConnections.messages.deleted',
}))
mock.module('@/features/Admin/DnsConnections/middleware.ts', () => ({
    getDnsConnectionsHandler: getConnections,
    testDnsConnectionHandler: testConnection,
    saveDnsConnectionHandler: saveConnection,
    deleteDnsConnectionHandler: deleteConnection,
}))

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: DnsConnectionsPage } = await import('@/features/Admin/DnsConnections/index.tsx')
let root: Root | null = null
let queryClient: InstanceType<typeof QueryClient>

async function waitFor(condition: () => boolean) {
    const deadline = Date.now() + 1800
    async function check(): Promise<void> {
        if (condition()) return
        if (Date.now() > deadline) throw new Error('Timed out waiting for DNS UI')
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
        await check()
    }
    await check()
}
async function renderPage(manage = true) {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
        root?.render(
            withTestLanguage(
                <QueryClientProvider client={queryClient}>
                    <DnsConnectionsPage
                        permissions={[
                            PERMISSIONS.DNS_CONNECTIONS_VIEW,
                            ...(manage ? [PERMISSIONS.DNS_CONNECTIONS_MANAGE] : []),
                        ]}
                    />
                </QueryClientProvider>,
            ),
        ),
    )
    await waitFor(
        () =>
            getConnections.mock.calls.length > 0 &&
            !document.body.textContent?.includes('Loading DNS connection metadata'),
    )
}
function button(label: string) {
    const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent?.trim() === label,
    )
    if (!result) throw new Error(`Missing button: ${label}`)
    return result
}
async function click(element: Element) {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
}
async function input(name: string, value: string) {
    const element = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
    if (!element) throw new Error(`Missing input ${name}`)
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            element,
            value,
        )
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
    })
}
async function submit() {
    await act(async () => {
        document
            .querySelector('form')
            ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
}
beforeEach(() => {
    connections = []
    queryFails = false
    testFails = false
    saveFails = false
    availableZones = [firstZone, secondZone]
    for (const fn of [getConnections, testConnection, saveConnection, deleteConnection])
        fn.mockClear()
})
afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    queryClient?.clear()
    document.body.innerHTML = ''
})

describe('Cloudflare DNS connection management', () => {
    test('view-only permission hides every write action', async () => {
        connections = [connection]
        await renderPage(false)
        expect(document.body.textContent).toContain('Office Cloudflare')
        expect(document.body.textContent).not.toContain('Add DNS connection')
        expect(document.body.textContent).not.toContain('Edit connection')
        expect(document.body.textContent).not.toContain('Delete connection')
    })
    test('loads two zones, saves all selections and never caches a new token', async () => {
        await renderPage()
        expect(document.body.textContent).toContain('No DNS connections yet')
        await click(button('Add DNS connection'))
        await input('name', 'New connection')
        await input('apiToken', 'write-only-test-token')
        await click(button('Test read access and load zones'))
        await waitFor(() => document.querySelectorAll('input[type="checkbox"]').length === 2)
        await click(document.querySelector(`input[aria-label="${firstZone.name}"]`)!)
        await click(document.querySelector(`input[aria-label="${secondZone.name}"]`)!)
        await submit()
        await waitFor(
            () => saveConnection.mock.calls.length === 1 && document.querySelector('form') === null,
        )
        expect(saveConnection.mock.calls[0]?.[0].data).toMatchObject({
            name: 'New connection',
            expectedRevision: 0,
            apiToken: 'write-only-test-token',
            zoneIds: [firstZone.id, secondZone.id],
        })
        expect(
            JSON.stringify(
                queryClient
                    .getQueryCache()
                    .getAll()
                    .map((entry) => entry.state),
            ),
        ).not.toContain('write-only-test-token')
        expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
        await click(button('Add DNS connection'))
        expect(document.querySelector<HTMLInputElement>('input[name="apiToken"]')?.value).toBe('')
    })
    test('blank replacement token retains saved credentials and revision', async () => {
        connections = [connection]
        await renderPage()
        await click(button('Edit connection'))
        expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(
            true,
        )
        await input('name', 'Renamed')
        await submit()
        await waitFor(() => saveConnection.mock.calls.length === 1)
        expect(saveConnection.mock.calls[0]?.[0].data).toMatchObject({
            connectionId: connection.id,
            expectedRevision: 3,
            name: 'Renamed',
            zoneIds: [firstZone.id],
        })
        expect(saveConnection.mock.calls[0]?.[0].data.apiToken).toBeUndefined()
    })
    test('replacement token discovers disjoint zones without silently dropping old selections', async () => {
        connections = [connection]
        availableZones = [secondZone]
        await renderPage()
        await click(button('Edit connection'))
        await input('apiToken', 'new-zone-only-token')
        await click(button('Test read access and load zones'))
        await waitFor(() => document.querySelectorAll('input[type="checkbox"]').length === 2)
        expect(testConnection.mock.calls[0]?.[0].data).toEqual({
            connectionId: connection.id,
            apiToken: 'new-zone-only-token',
            zoneIds: [],
        })
        const oldZone = document.querySelector<HTMLInputElement>(
            `input[aria-label="${firstZone.name}"]`,
        )!
        const newZone = document.querySelector<HTMLInputElement>(
            `input[aria-label="${secondZone.name}"]`,
        )!
        expect(oldZone.checked).toBe(true)
        expect(newZone.checked).toBe(false)
        await click(oldZone)
        await click(newZone)
        await submit()
        await waitFor(() => saveConnection.mock.calls.length === 1)
        expect(saveConnection.mock.calls[0]?.[0].data).toMatchObject({
            connectionId: connection.id,
            expectedRevision: connection.revision,
            apiToken: 'new-zone-only-token',
            zoneIds: [secondZone.id],
        })
    })
    test('failed token test preserves zones and cancel clears the secret', async () => {
        connections = [connection]
        testFails = true
        await renderPage()
        await click(button('Edit connection'))
        await input('apiToken', 'replacement-secret')
        await click(button('Test read access and load zones'))
        await waitFor(
            () => document.body.textContent?.includes('Cloudflare rejected the token') === true,
        )
        expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(
            true,
        )
        await click(button('Cancel'))
        await click(button('Edit connection'))
        expect(document.querySelector<HTMLInputElement>('input[name="apiToken"]')?.value).toBe('')
        expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
    })
    test('referenced zones stay selected and delete explains its disabled action', async () => {
        connections = [
            {
                ...connection,
                references: [{ zoneId: firstZone.id, consumer: { type: 'ddns', id: 'consumer' } }],
            },
        ]
        await renderPage()
        expect(button('Delete connection').disabled).toBe(true)
        expect(document.body.textContent).toContain('Remove all consumer references')
        await click(button('Edit connection'))
        expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(
            true,
        )
        expect(document.body.textContent).toContain('A consumer uses this zone')
    })
    test('conflicts offer explicit reload that discards the token and draft', async () => {
        connections = [connection]
        saveFails = true
        await renderPage()
        await click(button('Edit connection'))
        await input('apiToken', 'conflict-secret')
        await submit()
        await waitFor(
            () => document.body.textContent?.includes('changed since you opened it') === true,
        )
        connections = [{ ...connection, revision: 4, name: 'Updated elsewhere' }]
        await click(button('Discard draft and reload current connections'))
        await waitFor(() => document.body.textContent?.includes('Updated elsewhere') === true)
        await click(button('Edit connection'))
        expect(document.querySelector<HTMLInputElement>('input[name="apiToken"]')?.value).toBe('')
    })
    test('query failures have a working retry', async () => {
        queryFails = true
        await renderPage()
        expect(document.body.textContent).toContain('DNS connections unavailable')
        queryFails = false
        await click(button('Try again'))
        await waitFor(() => document.body.textContent?.includes('No DNS connections yet') === true)
    })
    test('deletion requires confirmation and invalidates safe metadata', async () => {
        connections = [connection]
        await renderPage()
        await click(button('Delete connection'))
        expect(deleteConnection.mock.calls).toHaveLength(0)
        const dialog = document.querySelector('[role="dialog"]')
        expect(dialog?.textContent).toContain('Office Cloudflare')
        const confirm = [...dialog!.querySelectorAll('button')].find(
            (item) => item.textContent === 'Delete connection',
        )!
        await click(confirm)
        await waitFor(
            () =>
                deleteConnection.mock.calls.length === 1 &&
                document.querySelector('[role="dialog"]') === null,
        )
        expect(deleteConnection.mock.calls[0]?.[0]).toEqual({
            data: { connectionId: connection.id, expectedRevision: 3 },
        })
        expect(getConnections.mock.calls.length).toBeGreaterThan(1)
    })
})

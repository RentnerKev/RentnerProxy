// oxlint-disable no-await-in-loop -- React updates must be flushed between bounded polling attempts.
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type {
    BulkHostResult,
    BulkHostApplyInput,
    BulkHostPreviewInput,
} from '@/lib/HostBulkActions/Types/bulk-hosts.types.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { HostTableRemote } from '@/features/Admin/HostTags/Types/host-table.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'
import { TOOLTIP_PROVIDER_PROPS } from '@/config/tooltip.config.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const firstId = '00000000-0000-4000-8000-000000000001'
const secondId = '00000000-0000-4000-8000-000000000002'
const preview = mock(
    async (_input: {
        data: BulkHostPreviewInput
    }): Promise<{ success: true; value: BulkHostResult }> => ({
        success: true,
        value: {
            runtimeStatus: 'unchanged',
            rows: [
                {
                    id: firstId,
                    label: 'one.example.test',
                    status: 'ready',
                    version: 'a'.repeat(64),
                },
                { id: secondId, label: 'two.example.test', status: 'skipped', reason: 'discovery' },
            ],
        },
    }),
)
const apply = mock(
    async (_input: {
        data: BulkHostApplyInput
    }): Promise<{ success: true; value: BulkHostResult }> => ({
        success: true,
        value: {
            runtimeStatus: 'pending',
            rows: [{ id: firstId, label: 'one.example.test', status: 'applied' }],
        },
    }),
)
mock.module('@/features/Admin/HostBulkActions/middleware.ts', () => ({
    previewBulkHostsHandler: preview,
    applyBulkHostsHandler: apply,
}))
mock.module('@/features/Admin/AccessPolicyManagement/middleware.ts', () => ({
    getAssignableAccessPoliciesHandler: async () => [],
}))
mock.module('@/features/Admin/CertificateManagement/middleware.ts', () => ({
    getAssignableCertificatesHandler: async () => [],
}))
mock.module('@/features/Admin/HostTags/middleware.ts', () => ({
    getHostTagCatalogHandler: async () => ({ revision: 0, tags: [] }),
    mutateHostTagHandler: async () => ({ success: true }),
}))
const { default: HostBulkModal } =
    await import('@/features/Admin/HostBulkActions/Components/HostBulkModal.tsx')
const { default: ProxyHostsTable } =
    await import('@/features/Admin/ProxyHostManagement/Components/ProxyHostsTable/index.tsx')
const { default: RedirectHostsTable } =
    await import('@/features/Admin/RedirectHostManagement/Components/RedirectHostsTable/index.tsx')
let root: Root | undefined
let client: InstanceType<typeof QueryClient>

async function render(element: ReactElement) {
    if (!root) {
        const container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
        client = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
    }
    await act(async () =>
        root!.render(
            withTestLanguage(
                <QueryClientProvider client={client}>
                    <TooltipProvider {...TOOLTIP_PROVIDER_PROPS}>{element}</TooltipProvider>
                </QueryClientProvider>,
                'de',
            ),
        ),
    )
}
function button(label: string): HTMLButtonElement {
    const target = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (element) =>
            element.textContent?.trim() === label || element.getAttribute('aria-label') === label,
    )
    expect(target).toBeDefined()
    return target!
}
async function click(target: Element) {
    await act(async () =>
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    )
}
async function waitFor(condition: () => boolean) {
    for (let attempt = 0; attempt < 80 && !condition(); attempt++)
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    expect(condition()).toBe(true)
}
function host(id: string, name: string): ProxyHostSummary {
    return {
        id,
        domains: [name],
        enabled: true,
        certificateId: null,
        forceHttps: false,
        forwardHost: '127.0.0.1',
        forwardPort: 8080,
        forwardScheme: 'http',
        verifyUpstreamTls: true,
        upstreamTlsServerName: null,
        trustedCaId: null,
        accessPolicyId: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
    }
}
const onStateChange = () => undefined
function remote(search = '', pageIndex = 0): HostTableRemote {
    return {
        rowCount: 200,
        domains: [],
        tags: [],
        onStateChange,
        initialState: {
            globalFilter: search,
            columnFilters: [],
            sorting: [],
            pagination: { pageIndex, pageSize: 10 },
        },
    }
}
function table(
    rows: ProxyHostSummary[],
    search = '',
    permissions: readonly PermissionKey[] = [
        PERMISSIONS.PROXY_HOSTS_VIEW,
        PERMISSIONS.PROXY_HOSTS_DISABLE,
    ],
) {
    return (
        <ProxyHostsTable
            proxyHosts={rows}
            bulkPermissions={permissions}
            remote={remote(search)}
            loading={false}
            canUpdate={false}
            canDelete={false}
            canEnable={false}
            canDisable={false}
            isPending={false}
            onEdit={() => undefined}
            onDelete={() => undefined}
            onDisable={() => undefined}
            onEnable={() => undefined}
        />
    )
}

beforeEach(() => {
    preview.mockClear()
    apply.mockClear()
})
afterEach(async () => {
    await act(async () => root?.unmount())
    client?.clear()
    document.body.innerHTML = ''
    root = undefined
})

test('read-only users have no bulk selection controls', async () => {
    await render(table([host(firstId, 'one.example.test')], '', [PERMISSIONS.PROXY_HOSTS_VIEW]))
    expect(document.querySelector('input[type="checkbox"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Sammelaktionen')
})
test('selection is explicit across pages, filter changes clear it permanently, and page selection is bounded', async () => {
    await render(table([host(firstId, 'one.example.test')]))
    const firstCheckbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => firstCheckbox.focus())
    await click(firstCheckbox)
    expect(document.activeElement).toBe(firstCheckbox)
    expect(document.querySelector('output')?.textContent).toContain('1 von 50')
    await render(table([host(secondId, 'two.example.test')]))
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    expect(document.querySelector('output')?.textContent).toContain('1 von 50')
    await click(button('Diese Seite hinzufügen'))
    expect(document.querySelector('output')?.textContent).toContain('2 von 50')
    await render(table([host(secondId, 'two.example.test')], 'changed'))
    expect(document.querySelector('output')?.textContent).toContain('0 von 50')
    await render(table([host(firstId, 'one.example.test')]))
    expect(document.querySelector('output')?.textContent).toContain('0 von 50')
    await render(
        table(
            Array.from({ length: 60 }, (_, index) =>
                host(
                    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
                    `host${index}.example.test`,
                ),
            ),
        ),
    )
    await click(button('Diese Seite hinzufügen'))
    expect(document.querySelector('output')?.textContent).toContain('50 von 50')
    expect(document.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(50)
})
test('requires a preview, sends only ready hosts, and keeps skipped rows and pending runtime visible', async () => {
    await render(
        <HostBulkModal
            kind="proxy"
            permissions={[PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_DISABLE]}
            hostIds={[firstId, secondId]}
            onOpenChange={() => undefined}
        />,
    )
    expect(button('Vorschau anwenden').disabled).toBe(true)
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-describedby')).toBeTruthy()
    await click(button('Änderungen vorschauen'))
    await waitFor(() => !button('Vorschau anwenden').disabled)
    expect(preview).toHaveBeenCalledTimes(1)
    expect(preview.mock.calls[0]).toEqual([
        { data: { kind: 'proxy', hostIds: [firstId, secondId], action: { type: 'disable' } } },
    ])
    await click(button('Vorschau anwenden'))
    await waitFor(() => document.body.textContent?.includes('Gespeichert') ?? false)
    expect(apply.mock.calls[0]).toEqual([
        {
            data: {
                kind: 'proxy',
                action: { type: 'disable' },
                hosts: [{ id: firstId, version: 'a'.repeat(64) }],
            },
        },
    ])
    expect(document.body.textContent).toContain('Übersprungen')
    expect(document.body.textContent).toContain('Docker-Discovery')
    expect(document.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    expect(button('Vorschau anwenden').disabled).toBe(true)
    await click(button('Erneut vorschauen'))
    await waitFor(() => preview.mock.calls.length === 2)
})
test('changing an action invalidates its preview before another mutation', async () => {
    await render(
        <HostBulkModal
            kind="proxy"
            permissions={[
                PERMISSIONS.PROXY_HOSTS_VIEW,
                PERMISSIONS.PROXY_HOSTS_ENABLE,
                PERMISSIONS.PROXY_HOSTS_DISABLE,
            ]}
            hostIds={[firstId, secondId]}
            onOpenChange={() => undefined}
        />,
    )
    await click(button('Änderungen vorschauen'))
    await waitFor(() => !button('Vorschau anwenden').disabled)
    const select = document.querySelector<HTMLElement>('[role="combobox"]')!
    await act(async () =>
        select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    )
    await waitFor(() => document.querySelectorAll('[role="option"]').length === 2)
    const option = [...document.querySelectorAll('[role="option"]')].find((element) =>
        element.textContent?.includes('Deaktivieren'),
    )!
    await click(option)
    expect(button('Vorschau anwenden').disabled).toBe(true)
    expect(apply).not.toHaveBeenCalled()
})
test('a failed apply clears the preview and never displays internal error content', async () => {
    apply.mockRejectedValueOnce(new Error('private credential fixture'))
    await render(
        <HostBulkModal
            kind="proxy"
            permissions={[PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_DISABLE]}
            hostIds={[firstId, secondId]}
            onOpenChange={() => undefined}
        />,
    )
    await click(button('Änderungen vorschauen'))
    await waitFor(() => !button('Vorschau anwenden').disabled)
    await click(button('Vorschau anwenden'))
    await waitFor(() => document.querySelector('[role="alert"]') !== null)
    expect(document.body.textContent).not.toContain('credential')
    expect(button('Vorschau anwenden').disabled).toBe(true)
})
test('redirect-only managers can select redirect hosts with their own permissions', async () => {
    await render(
        <RedirectHostsTable
            redirectHosts={[
                {
                    id: firstId,
                    domains: ['redirect.example.test'],
                    destination: 'https://example.test',
                    statusCode: 302,
                    preserveRequestUri: true,
                    enabled: true,
                    certificateId: null,
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                },
            ]}
            bulkPermissions={[PERMISSIONS.REDIRECT_HOSTS_VIEW, PERMISSIONS.REDIRECT_HOSTS_DISABLE]}
            loading={false}
            canUpdate={false}
            canDelete={false}
            canEnable={false}
            canDisable={false}
            isPending={false}
            onEdit={() => undefined}
            onDelete={() => undefined}
            onDisable={() => undefined}
            onEnable={() => undefined}
        />,
    )
    await click(document.querySelector('input[type="checkbox"]')!)
    expect(button('Sammelaktionen').disabled).toBe(false)
    await click(button('Sammelaktionen'))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('admin.bulkHosts')
})

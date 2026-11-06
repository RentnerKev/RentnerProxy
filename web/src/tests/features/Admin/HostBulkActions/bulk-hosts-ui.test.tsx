// oxlint-disable no-await-in-loop -- React updates must be flushed between bounded polling attempts.
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { toast } from '@rentnerkev/toasts'
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
import { TOOLTIP_PROVIDER_PROPS } from '@/config/tooltip.config.ts'

if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register({ settings: { device: { prefersReducedMotion: 'reduce' } } })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
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
const certificates = mock(async () => [])
mock.module('@/features/Admin/CertificateManagement/middleware.ts', () => ({
    getAssignableCertificatesHandler: certificates,
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
let successToast: ReturnType<typeof spyOn<typeof toast, 'success'>>
let errorToast: ReturnType<typeof spyOn<typeof toast, 'error'>>
let warningToast: ReturnType<typeof spyOn<typeof toast, 'warning'>>
let root: Root | undefined
let client: InstanceType<typeof QueryClient>

async function render(element: ReactElement, language: 'de' | 'en' = 'de') {
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
                language,
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
    successToast = spyOn(toast, 'success').mockReturnValue('success')
    errorToast = spyOn(toast, 'error').mockReturnValue('error')
    warningToast = spyOn(toast, 'warning').mockReturnValue('warning')
    preview.mockClear()
    apply.mockClear()
    certificates.mockClear()
})
afterEach(async () => {
    await act(async () => root?.unmount())
    client?.clear()
    document.body.innerHTML = ''
    root = undefined
    successToast.mockRestore()
    errorToast.mockRestore()
    warningToast.mockRestore()
})

test('read-only users have no bulk selection controls', async () => {
    await render(table([host(firstId, 'one.example.test')], '', [PERMISSIONS.PROXY_HOSTS_VIEW]))
    expect(document.querySelector('input[type="checkbox"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Sammelaktionen')
})
test('selection is explicit across pages, filter changes clear it permanently, and page selection is bounded', async () => {
    await render(table([host(firstId, 'one.example.test')]))
    expect(document.querySelector('output')).toBeNull()
    expect(document.body.textContent).not.toContain('Diese Seite hinzufügen')
    const firstCheckbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(firstCheckbox.getAttribute('aria-label')).toBe('one.example.test auswählen')
    expect(firstCheckbox.closest('td')?.textContent?.trim()).toBe('')
    await act(async () => firstCheckbox.focus())
    await click(firstCheckbox)
    expect(document.activeElement).toBe(firstCheckbox)
    expect(document.querySelector('output')?.textContent).toContain('1 von 50')
    await click(firstCheckbox)
    expect(document.querySelector('output')).toBeNull()
    expect(document.body.textContent).not.toContain('Diese Seite hinzufügen')
    await click(firstCheckbox)
    await render(table([host(secondId, 'two.example.test')]))
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    expect(document.querySelector('output')?.textContent).toContain('1 von 50')
    await click(button('Diese Seite hinzufügen'))
    expect(document.querySelector('output')?.textContent).toContain('2 von 50')
    await render(table([host(secondId, 'two.example.test')], 'changed'))
    expect(document.querySelector('output')).toBeNull()
    await render(table([host(firstId, 'one.example.test')]))
    expect(document.querySelector('output')).toBeNull()
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
    await click(document.querySelector('input[type="checkbox"]')!)
    await click(button('Diese Seite hinzufügen'))
    expect(document.querySelector('output')?.textContent).toContain('50 von 50')
    expect(document.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(50)
    await click(button('Auswahl leeren'))
    expect(document.querySelector('output')).toBeNull()
    expect(document.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0)
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
    expect(warningToast).toHaveBeenCalledWith(expect.any(String), { title: 'Bitte beachten' })
    expect(warningToast.mock.calls[0]?.[0]).not.toContain('admin.')
    expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull()
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
    await waitFor(() => errorToast.mock.calls.length === 1)
    expect(errorToast).toHaveBeenCalledWith(
        'Die Anfrage ist fehlgeschlagen. Erstelle eine neue Vorschau und versuche es erneut.',
        { title: 'Aktion fehlgeschlagen' },
    )
    expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull()
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

test('failed preview reports a localized toast without revealing internal errors', async () => {
    preview.mockRejectedValueOnce(new Error('private preview fixture'))
    await render(
        <HostBulkModal
            kind="proxy"
            permissions={[PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_DISABLE]}
            hostIds={[firstId]}
            onOpenChange={() => undefined}
        />,
    )
    await click(button('Änderungen vorschauen'))
    await waitFor(() => errorToast.mock.calls.length === 1)
    expect(errorToast).toHaveBeenCalledWith(
        'Die Anfrage ist fehlgeschlagen. Erstelle eine neue Vorschau und versuche es erneut.',
        { title: 'Aktion fehlgeschlagen' },
    )
    expect(button('Vorschau anwenden').disabled).toBe(true)
    expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull()
    expect(document.body.textContent).not.toContain('private preview fixture')
})

test('fully applied batches report success while partial results report a warning', async () => {
    apply.mockResolvedValueOnce({
        success: true,
        value: {
            runtimeStatus: 'applied',
            rows: [{ id: firstId, label: 'one.example.test', status: 'applied' }],
        },
    })
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
    await waitFor(() => warningToast.mock.calls.length === 1)
    expect(warningToast).toHaveBeenCalledWith(
        expect.stringContaining('fehlgeschlagene oder übersprungene Hosts'),
        { title: 'Bitte beachten' },
    )
    expect(successToast).not.toHaveBeenCalled()
    preview.mockResolvedValueOnce({
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
            ],
        },
    })
    apply.mockResolvedValueOnce({
        success: true,
        value: {
            runtimeStatus: 'applied',
            rows: [{ id: firstId, label: 'one.example.test', status: 'applied' }],
        },
    })
    await click(button('Erneut vorschauen'))
    await waitFor(() => !button('Vorschau anwenden').disabled)
    await click(button('Vorschau anwenden'))
    await waitFor(() => successToast.mock.calls.length === 1)
    expect(successToast).toHaveBeenCalledWith('Gespeichert', { title: 'Erfolgreich' })
})

test('failed assignment loading reports one toast and keeps preview blocked across renders', async () => {
    certificates.mockRejectedValueOnce(new Error('private options fixture'))
    const modal = (
        <HostBulkModal
            kind="proxy"
            permissions={[PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_UPDATE]}
            hostIds={[firstId]}
            onOpenChange={() => undefined}
        />
    )
    await render(modal)
    const select = document.querySelector<HTMLElement>('[role="combobox"]')!
    await act(async () =>
        select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    )
    await waitFor(() => document.querySelectorAll('[role="option"]').length === 3)
    const certificate = [...document.querySelectorAll('[role="option"]')].find((option) =>
        option.textContent?.includes('Zertifikat zuweisen'),
    )!
    await click(certificate)
    await waitFor(() => errorToast.mock.calls.length === 1)
    expect(button('Änderungen vorschauen').disabled).toBe(true)
    expect(errorToast).toHaveBeenCalledWith(
        'Die Anfrage ist fehlgeschlagen. Erstelle eine neue Vorschau und versuche es erneut.',
        { title: 'Aktion fehlgeschlagen' },
    )
    await render(<HostBulkModal {...modal.props} />, 'en')
    expect(errorToast).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull()
    expect(document.body.textContent).not.toContain('private options fixture')
})

test('an options failure after update permission is revoked does not emit a toast', async () => {
    let fail!: (error: Error) => void
    certificates.mockImplementationOnce(
        () =>
            new Promise((_resolve, reject) => {
                fail = reject
            }),
    )
    const modalProps = {
        kind: 'proxy' as const,
        permissions: [PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_UPDATE],
        hostIds: [firstId],
        onOpenChange: () => undefined,
    }
    await render(<HostBulkModal {...modalProps} />)
    const select = document.querySelector<HTMLElement>('[role="combobox"]')!
    await act(async () =>
        select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    )
    await waitFor(() => document.querySelectorAll('[role="option"]').length === 3)
    await click(
        [...document.querySelectorAll('[role="option"]')].find((option) =>
            option.textContent?.includes('Zertifikat zuweisen'),
        )!,
    )
    await render(<HostBulkModal {...modalProps} permissions={[PERMISSIONS.PROXY_HOSTS_VIEW]} />)
    await act(async () => {
        fail(new Error('private late options error'))
        await new Promise((resolve) => setTimeout(resolve, 15))
    })
    expect(errorToast).not.toHaveBeenCalled()
    expect(button('Änderungen vorschauen').disabled).toBe(true)
})

test.each(['hosts', 'permissions'] as const)(
    'late successful previews cannot restore old ready rows after %s changes',
    async (change) => {
        let finish!: (value: { success: true; value: BulkHostResult }) => void
        preview.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve
                }),
        )
        const modalProps = {
            kind: 'proxy' as const,
            permissions: [PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_DISABLE],
            hostIds: [firstId],
            onOpenChange: () => undefined,
        }
        await render(<HostBulkModal {...modalProps} />)
        await click(button('Änderungen vorschauen'))
        await render(
            <HostBulkModal
                {...modalProps}
                hostIds={change === 'hosts' ? [secondId] : [firstId]}
                permissions={
                    change === 'permissions'
                        ? [PERMISSIONS.PROXY_HOSTS_VIEW]
                        : modalProps.permissions
                }
            />,
        )
        await act(async () => {
            finish({
                success: true,
                value: {
                    runtimeStatus: 'unchanged',
                    rows: [
                        {
                            id: firstId,
                            label: 'old.example.test',
                            status: 'ready',
                            version: 'a'.repeat(64),
                        },
                    ],
                },
            })
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
        expect(document.querySelector('tbody')).toBeNull()
        expect(button('Vorschau anwenden').disabled).toBe(true)
        expect(errorToast).not.toHaveBeenCalled()
    },
)

test.each(['unmount', 'hosts', 'permissions'] as const)(
    'late preview failures do not affect the modal after %s changes',
    async (change) => {
        let fail!: (error: Error) => void
        preview.mockImplementationOnce(
            () =>
                new Promise((_resolve, reject) => {
                    fail = reject
                }),
        )
        const modalProps = {
            kind: 'proxy' as const,
            permissions: [PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_DISABLE],
            hostIds: [firstId],
            onOpenChange: () => undefined,
        }
        await render(<HostBulkModal {...modalProps} />)
        await click(button('Änderungen vorschauen'))
        if (change === 'unmount') {
            await act(async () => root?.unmount())
            root = undefined
        } else {
            await render(
                <HostBulkModal
                    {...modalProps}
                    hostIds={change === 'hosts' ? [secondId] : [firstId]}
                    permissions={
                        change === 'permissions'
                            ? [PERMISSIONS.PROXY_HOSTS_VIEW]
                            : modalProps.permissions
                    }
                />,
            )
        }
        await act(async () => {
            fail(new Error('private late preview error'))
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
        expect(errorToast).not.toHaveBeenCalled()
        expect(successToast).not.toHaveBeenCalled()
    },
)

test.each(['unmount', 'hosts', 'permissions'] as const)(
    'late applied results invalidate host data without old feedback after %s changes',
    async (change) => {
        let finish!: (value: { success: true; value: BulkHostResult }) => void
        apply.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve
                }),
        )
        const modalProps = {
            kind: 'proxy' as const,
            permissions: [PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_DISABLE],
            hostIds: [firstId],
            onOpenChange: () => undefined,
        }
        await render(<HostBulkModal {...modalProps} />)
        await click(button('Änderungen vorschauen'))
        await waitFor(() => !button('Vorschau anwenden').disabled)
        const invalidate = spyOn(client, 'invalidateQueries')
        try {
            await click(button('Vorschau anwenden'))
            if (change === 'unmount') {
                await act(async () => root?.unmount())
                root = undefined
            } else {
                await render(
                    <HostBulkModal
                        {...modalProps}
                        hostIds={change === 'hosts' ? [secondId] : [firstId]}
                        permissions={
                            change === 'permissions'
                                ? [PERMISSIONS.PROXY_HOSTS_VIEW]
                                : modalProps.permissions
                        }
                    />,
                )
            }
            await act(async () => {
                finish({
                    success: true,
                    value: {
                        runtimeStatus: 'applied',
                        rows: [{ id: firstId, label: 'old.example.test', status: 'applied' }],
                    },
                })
                await new Promise((resolve) => setTimeout(resolve, 15))
            })
            expect(invalidate).toHaveBeenCalledTimes(2)
            expect(successToast).not.toHaveBeenCalled()
            expect(warningToast).not.toHaveBeenCalled()
            expect(document.querySelector('caption')?.textContent ?? '').not.toContain('Ergebnisse')
            if (change !== 'unmount') expect(button('Vorschau anwenden').disabled).toBe(true)
        } finally {
            invalidate.mockRestore()
        }
    },
)

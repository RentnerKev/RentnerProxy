import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { QueryClient as QueryClientInstance } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { PERMISSIONS } from '../config/permissions.config'
import type { ProxyHostSummary } from '../shared/Types/proxy-hosts.types'
import type {
    ProxyHostActionResult,
    ProxyRuntimeSyncStatus,
} from '../shared/Types/proxy-runtime.types'
import { proxyHostManagementQueryKeys } from '../features/Admin/ProxyHostManagement/queryKeys'
import withTestLanguage, { withLanguageRoot } from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('../shared/Tooltip')
const { default: ToastProvider } = await import('../shared/Toast/Components/ToastProvider')
const { default: ProxyHostManagementPage } = await import('../features/Admin/ProxyHostManagement')
const { default: ProxyHostFormModal } =
    await import('../features/Admin/ProxyHostManagement/Components/ProxyHostFormModal')
const { default: ProxyHostTableActions } =
    await import('../features/Admin/ProxyHostManagement/Components/ProxyHostTableActions')
const { default: ProxyRuntimeStatusPanel } =
    await import('../features/Admin/ProxyHostManagement/Components/ProxyRuntimeStatusPanel')

const getProxyHostsHandlerMock = mock(async (): Promise<ProxyHostSummary[]> => [])
const getProxyRuntimeStatusHandlerMock = mock(async (): Promise<ProxyRuntimeSyncStatus> => ({
    available: true,
    running: true,
    activeRevision: 'sha256:active',
    desiredRevision: 'sha256:active',
    lastApplyAt: '2026-01-02T12:00:00.000Z',
    state: 'synced' as const,
}))
const applyProxyConfigurationHandlerMock = mock(async () => ({
    success: true,
    message: 'admin.proxyHosts.runtime.applied',
}))
const createProxyHostHandlerMock = mock(
    async (_input: unknown): Promise<ProxyHostActionResult> => ({
        success: true,
        message: 'admin.proxyHosts.messages.created',
        runtimeStatus: 'applied',
    }),
)
const updateProxyHostHandlerMock = mock(
    async (_input: unknown): Promise<ProxyHostActionResult> => ({
        success: true,
        message: 'admin.proxyHosts.messages.updated',
        runtimeStatus: 'applied',
    }),
)
const deleteProxyHostHandlerMock = mock(
    async (_input: unknown): Promise<ProxyHostActionResult> => ({
        success: true,
        message: 'admin.proxyHosts.messages.deleted',
        runtimeStatus: 'applied',
    }),
)
const enableProxyHostHandlerMock = mock(
    async (_input: unknown): Promise<ProxyHostActionResult> => ({
        success: true,
        message: 'admin.proxyHosts.messages.enabled',
        runtimeStatus: 'applied',
    }),
)
const disableProxyHostHandlerMock = mock(
    async (_input: unknown): Promise<ProxyHostActionResult> => ({
        success: true,
        message: 'admin.proxyHosts.messages.disabled',
        runtimeStatus: 'applied',
    }),
)

mock.module('../features/Admin/ProxyHostManagement/server', () => ({
    createProxyHostHandler: createProxyHostHandlerMock,
    deleteProxyHostHandler: deleteProxyHostHandlerMock,
    disableProxyHostHandler: disableProxyHostHandlerMock,
    enableProxyHostHandler: enableProxyHostHandlerMock,
    getProxyRuntimeStatusHandler: getProxyRuntimeStatusHandlerMock,
    getProxyHostsHandler: getProxyHostsHandlerMock,
    applyProxyConfigurationHandler: applyProxyConfigurationHandlerMock,
    updateProxyHostHandler: updateProxyHostHandlerMock,
}))

let activeRoot: Root | null = null
let activeQueryClient: QueryClientInstance | null = null

const enabledHost: ProxyHostSummary = {
    createdAt: new Date('2026-01-02T12:00:00Z'),
    domains: ['app.example.com', 'www.example.com', 'api.example.com'],
    enabled: true,
    forwardHost: '192.0.2.10',
    forwardPort: 8080,
    forwardScheme: 'http',
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54019',
    updatedAt: new Date('2026-01-02T12:00:00Z'),
}
const disabledHost: ProxyHostSummary = {
    ...enabledHost,
    createdAt: new Date('2026-01-03T12:00:00Z'),
    domains: ['disabled.example.com'],
    enabled: false,
    forwardHost: '2001:db8::1',
    forwardPort: 443,
    forwardScheme: 'https',
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54020',
}

async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = withLanguageRoot(createRoot(container))
    await act(async () => {
        activeRoot?.render(
            <TooltipProvider>
                <ToastProvider>{element}</ToastProvider>
            </TooltipProvider>,
        )
    })
    return container
}

function withQueryClient(element: ReactElement): ReactElement {
    activeQueryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return <QueryClientProvider client={activeQueryClient}>{element}</QueryClientProvider>
}

async function renderPage(permissions: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][]) {
    return render(withQueryClient(<ProxyHostManagementPage permissions={permissions} />))
}

async function click(element: Element): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
}

async function openMenu(trigger: Element): Promise<void> {
    await act(async () => {
        trigger.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                button: 0,
                cancelable: true,
                pointerType: 'mouse',
            }),
        )
        await Promise.resolve()
    })
    await waitFor(() => document.querySelector('[role="menu"]') !== null)
}

async function chooseSelectOption(ariaLabel: string, optionLabel: string): Promise<void> {
    const trigger = getButton(ariaLabel)
    await act(async () => {
        trigger.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                button: 0,
                cancelable: true,
                pointerType: 'mouse',
            }),
        )
        await Promise.resolve()
    })
    await waitFor(() => document.querySelector('[role="listbox"]') !== null)
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (candidate) => candidate.textContent?.trim() === optionLabel,
    )
    expect(option).toBeDefined()
    await act(async () => {
        option?.dispatchEvent(
            new PointerEvent('pointerup', {
                bubbles: true,
                button: 0,
                cancelable: true,
                pointerType: 'mouse',
            }),
        )
        option?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
    await waitFor(() => document.querySelector('[role="listbox"]') === null)
}

async function setControlValue(
    control: HTMLInputElement | HTMLTextAreaElement,
    value: string,
): Promise<void> {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
            control instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype,
            'value',
        )?.set
        setter?.call(control, value)
        control.dispatchEvent(new Event('input', { bubbles: true }))
        control.dispatchEvent(new Event('change', { bubbles: true }))
        await Promise.resolve()
    })
}

async function blurControl(control: HTMLElement): Promise<void> {
    await act(async () => {
        control.focus()
        control.blur()
        await Promise.resolve()
    })
}

async function waitFor(condition: () => boolean, timeoutMs = 1_500): Promise<void> {
    const waitUntil = async (deadline: number): Promise<void> => {
        if (condition()) return
        if (Date.now() >= deadline) {
            expect(condition()).toBeTrue()
            return
        }
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
        await waitUntil(deadline)
    }

    await waitUntil(Date.now() + timeoutMs)
}

async function waitForToast(
    tone: 'error' | 'success' | 'warning',
    message?: string,
): Promise<void> {
    await waitFor(() => document.querySelector('[data-toast-tone="' + tone + '"]') !== null)
    await waitFor(() => {
        const announcement = document.querySelector('[aria-live]')
        return (
            announcement !== null &&
            (message === undefined || announcement.textContent?.includes(message) === true)
        )
    })
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
    })
}

function getButton(label: string): HTMLButtonElement {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) =>
            candidate.textContent?.trim().includes(label) ||
            candidate.getAttribute('aria-label') === label,
    )
    expect(button).toBeDefined()
    return button!
}

function getMenuItem(label: string): HTMLElement {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (candidate) => candidate.textContent?.includes(label),
    )
    expect(item).toBeDefined()
    return item!
}

function getRows(): HTMLTableRowElement[] {
    return [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')]
}

function getLastButton(label: string): HTMLButtonElement {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
        (candidate) => candidate.textContent?.trim().includes(label),
    )
    expect(buttons.length).toBeGreaterThan(0)
    return buttons.at(-1)!
}

beforeEach(() => {
    getProxyHostsHandlerMock.mockReset()
    getProxyRuntimeStatusHandlerMock.mockReset()
    applyProxyConfigurationHandlerMock.mockReset()
    createProxyHostHandlerMock.mockReset()
    updateProxyHostHandlerMock.mockReset()
    deleteProxyHostHandlerMock.mockReset()
    enableProxyHostHandlerMock.mockReset()
    disableProxyHostHandlerMock.mockReset()
    getProxyHostsHandlerMock.mockResolvedValue([enabledHost, disabledHost])
    getProxyRuntimeStatusHandlerMock.mockResolvedValue({
        available: true,
        running: true,
        activeRevision: 'sha256:active',
        desiredRevision: 'sha256:active',
        lastApplyAt: '2026-01-02T12:00:00.000Z',
        state: 'synced',
    })
    applyProxyConfigurationHandlerMock.mockResolvedValue({
        success: true,
        message: 'admin.proxyHosts.runtime.applied',
    })
    createProxyHostHandlerMock.mockResolvedValue({
        success: true,
        message: 'admin.proxyHosts.messages.created',
        runtimeStatus: 'applied',
    })
    updateProxyHostHandlerMock.mockResolvedValue({
        success: true,
        message: 'admin.proxyHosts.messages.updated',
        runtimeStatus: 'applied',
    })
    deleteProxyHostHandlerMock.mockResolvedValue({
        success: true,
        message: 'admin.proxyHosts.messages.deleted',
        runtimeStatus: 'applied',
    })
    enableProxyHostHandlerMock.mockResolvedValue({
        success: true,
        message: 'admin.proxyHosts.messages.enabled',
        runtimeStatus: 'applied',
    })
    disableProxyHostHandlerMock.mockResolvedValue({
        success: true,
        message: 'admin.proxyHosts.messages.disabled',
        runtimeStatus: 'applied',
    })
})

afterEach(async () => {
    if (activeRoot) {
        await act(async () => activeRoot?.unmount())
    }
    activeRoot = null
    activeQueryClient?.clear()
    activeQueryClient = null
    document.body.replaceChildren()
})

const allManagementPermissions = [
    PERMISSIONS.PROXY_HOSTS_VIEW,
    PERMISSIONS.PROXY_HOSTS_CREATE,
    PERMISSIONS.PROXY_HOSTS_UPDATE,
    PERMISSIONS.PROXY_HOSTS_DELETE,
    PERMISSIONS.PROXY_HOSTS_ENABLE,
    PERMISSIONS.PROXY_HOSTS_DISABLE,
] as const

describe('ProxyHost management table', () => {
    test('renders all columns, compact domain overflow, forward target, IPv6, and status', async () => {
        await renderPage(allManagementPermissions)
        await waitFor(() => getRows().length === 2)
        const headers = [...document.querySelectorAll('thead th')].map((cell) => cell.textContent)
        expect(headers.join(' ')).toContain('Domains')
        expect(headers.join(' ')).toContain('Forward target')
        expect(headers.join(' ')).toContain('Status')
        expect(document.body.textContent).toContain('app.example.com')
        expect(document.body.textContent).toContain('+1')
        expect(document.body.textContent).toContain('https://[2001:db8::1]:443')
        expect(document.body.textContent).toContain('Enabled')
        expect(document.body.textContent).toContain('Disabled')
    })

    test('searches aliases and IP/port/scheme, filters status and scheme, sorts, and paginates', async () => {
        const hosts: ProxyHostSummary[] = Array.from({ length: 12 }, (_, index) => ({
            ...enabledHost,
            domains: [`host-${index}.example.com`],
            forwardHost: `192.0.2.${index + 1}`,
            forwardPort: 8000 + index,
            forwardScheme: index % 2 === 0 ? 'http' : 'https',
            id: `018f2f52-7c1b-7cc0-9f3c-6a9952c5${String(index).padStart(3, '0')}`,
        }))
        getProxyHostsHandlerMock.mockResolvedValueOnce(hosts)
        await renderPage(allManagementPermissions)
        await waitFor(() => getRows().length === 10)
        const search = document.querySelector<HTMLInputElement>('input[type="search"]')!
        await setControlValue(search, '192.0.2.12')
        await waitFor(() => getRows().length === 1)
        await setControlValue(search, '')
        await click(getButton('Filters'))
        await chooseSelectOption('All schemes', 'HTTPS')
        await chooseSelectOption('All statuses', 'Enabled')
        expect(getRows().length).toBeGreaterThan(0)
        await click(getButton('Reset filters'))
        await click(getButton('Sort by domains'))
        await chooseSelectOption('Rows per page', '10')
        await click(getButton('Go to next page'))
        expect(document.body.textContent).toContain('Page 2 of 2')
    })

    test('sorts Created newest first by date and toggles to oldest first', async () => {
        const hosts: ProxyHostSummary[] = [
            {
                ...enabledHost,
                domains: ['zulu.example.com'],
                createdAt: new Date('2026-02-01T12:00:00Z'),
                id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54030',
            },
            {
                ...enabledHost,
                domains: ['alpha.example.com'],
                createdAt: new Date('2026-01-01T12:00:00Z'),
                id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54031',
            },
            {
                ...enabledHost,
                domains: ['middle.example.com'],
                createdAt: new Date('2026-03-01T12:00:00Z'),
                id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54032',
            },
        ]
        getProxyHostsHandlerMock.mockResolvedValueOnce(hosts)
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        await waitFor(() => getRows().length === 3)

        const domainOrder = () =>
            getRows().map((row) => row.querySelector('td')?.textContent?.trim())
        const createdSortButton = getButton('Sort by createdAt')
        const createdHeader = createdSortButton.closest('th')!
        expect(createdHeader.textContent).toContain('Created')
        expect(createdHeader.getAttribute('aria-sort')).toBe('descending')
        expect(domainOrder()).toEqual([
            'middle.example.com',
            'zulu.example.com',
            'alpha.example.com',
        ])

        await click(createdSortButton)
        await waitFor(() => createdHeader.getAttribute('aria-sort') === 'ascending')
        expect(domainOrder()).toEqual([
            'alpha.example.com',
            'zulu.example.com',
            'middle.example.com',
        ])
    })
    test('shows loading, empty, and filtered-empty states', async () => {
        let resolveHosts: ((hosts: ProxyHostSummary[]) => void) | undefined
        getProxyHostsHandlerMock.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveHosts = resolve
                }),
        )
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        expect(document.querySelector('tbody[aria-busy="true"]')).not.toBeNull()
        resolveHosts?.([])
        await waitFor(() => document.body.textContent?.includes('No proxy hosts yet') ?? false)

        getProxyHostsHandlerMock.mockResolvedValueOnce([enabledHost])
        await act(async () => activeRoot?.unmount())
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        await waitFor(() => getRows().length === 1)
        await setControlValue(document.querySelector('input[type="search"]')!, 'missing')
        await waitFor(() => document.body.textContent?.includes('No proxy hosts match') ?? false)
    })
})

describe('ProxyHost permissions and row actions', () => {
    test('Viewer sees read-only content and no management action', async () => {
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        await waitFor(() => getRows().length === 2)
        expect(document.body.textContent).not.toContain('Add proxy host')
        expect(document.querySelector('[aria-label="Open actions for app.example.com"]')).toBeNull()
    })

    test('shows only dynamic custom actions for the granted permissions', async () => {
        const onEdit = mock(() => undefined)
        const onDelete = mock(() => undefined)
        await render(
            withTestLanguage(
                <ProxyHostTableActions
                    host={enabledHost}
                    canUpdate
                    canDelete
                    canEnable={false}
                    canDisable={false}
                    isPending={false}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onEnable={() => undefined}
                    onDisable={() => undefined}
                />,
            ),
        )
        await openMenu(getButton('Open actions for app.example.com'))
        expect(document.querySelector('[role="menu"]')?.textContent).toContain('Edit')
        expect(document.querySelector('[role="menu"]')?.textContent).toContain('Delete')
        expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('Disable')
    })

    test('hides synchronized runtime status and its apply action', async () => {
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        await waitFor(() => getRows().length === 2)
        expect(document.body.textContent).not.toContain('Proxy runtime synchronized')
        expect(document.body.textContent).not.toContain('Apply changes')
    })

    test('apply permission sees the action when the runtime is pending', async () => {
        const onApply = mock(() => undefined)
        await render(
            withTestLanguage(
                <ProxyRuntimeStatusPanel
                    canApply
                    isApplying={false}
                    onApply={onApply}
                    status={{
                        available: true,
                        running: true,
                        activeRevision: 'sha256:old',
                        desiredRevision: 'sha256:new',
                        lastApplyAt: null,
                        state: 'pending',
                    }}
                />,
            ),
        )
        expect(document.body.textContent).toContain('Saved changes are waiting to be applied.')
        expect(getButton('Apply changes')).toBeDefined()
        await click(getButton('Apply changes'))
        expect(onApply).toHaveBeenCalledTimes(1)
    })
})

function FormHarness({
    canDisable = true,
    canEnable = true,
    mode,
    proxyHost,
}: {
    canDisable?: boolean
    canEnable?: boolean
    mode: 'create' | 'edit'
    proxyHost?: ProxyHostSummary
}) {
    const [open, setOpen] = useState(true)
    return (
        <ProxyHostFormModal
            open={open}
            mode={mode}
            {...(proxyHost ? { proxyHost } : {})}
            canEnable={canEnable}
            canDisable={canDisable}
            onOpenChange={setOpen}
            onSuccess={() => setOpen(false)}
        />
    )
}

describe('ProxyHost form modal', () => {
    test('creates normalized multiple domains and invalidates the query with a localized toast', async () => {
        await render(withQueryClient(<FormHarness mode="create" />))
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!,
            'Example.COM',
        )
        await blurControl(document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!)
        await click(getButton('Add domain'))
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="domains[1]"]')!,
            'Other.Example',
        )
        await blurControl(document.querySelector<HTMLInputElement>('input[name="domains[1]"]')!)
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!,
            'backend.internal',
        )
        await blurControl(document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!)
        await blurControl(document.querySelector<HTMLInputElement>('input[name="forwardPort"]')!)
        const invalidate = spyOn(activeQueryClient!, 'invalidateQueries')
        expect(getButton('Create proxy host').disabled).toBeFalse()

        await click(getButton('Create proxy host'))

        await waitFor(() => createProxyHostHandlerMock.mock.calls.length === 1)
        expect(createProxyHostHandlerMock).toHaveBeenCalledWith({
            data: {
                domains: ['example.com', 'other.example'],
                enabled: true,
                forwardHost: 'backend.internal',
                forwardPort: 80,
                forwardScheme: 'http',
            },
        })
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: proxyHostManagementQueryKeys.all,
            exact: true,
        })
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: proxyHostManagementQueryKeys.runtimeStatus,
        })
        await waitForToast('success', 'Proxy host created successfully.')
        expect(document.querySelector('[data-toast-tone="success"]')?.textContent).toContain(
            'Proxy host created successfully.',
        )
        invalidate.mockRestore()
    })

    test('closes after a saved but pending runtime apply and shows a warning', async () => {
        createProxyHostHandlerMock.mockResolvedValueOnce({
            success: true,
            message: 'admin.proxyHosts.messages.created',
            runtimeStatus: 'pending',
        })
        await render(withQueryClient(<FormHarness mode="create" />))
        const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
        await setControlValue(domain, 'pending.example.com')
        await blurControl(domain)
        const forwardHost = document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!
        await setControlValue(forwardHost, 'backend.internal')
        await blurControl(forwardHost)
        await blurControl(document.querySelector<HTMLInputElement>('input[name="forwardPort"]')!)
        await click(getButton('Create proxy host'))
        await waitForToast('warning', 'Saved changes are waiting to be applied.')
        await waitFor(() => document.querySelector('[role="dialog"]') === null)
    })

    test('clears a normalized duplicate after correction and submits successfully', async () => {
        await render(withQueryClient(<FormHarness mode="create" />))
        const firstDomain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
        await setControlValue(firstDomain, 'Example.COM')
        await blurControl(firstDomain)
        await click(getButton('Add domain'))
        const duplicateDomain = document.querySelector<HTMLInputElement>(
            'input[name="domains[1]"]',
        )!
        await setControlValue(duplicateDomain, 'example.com.')
        await blurControl(duplicateDomain)
        const forwardHost = document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!
        await setControlValue(forwardHost, 'backend.internal')
        await blurControl(forwardHost)
        await blurControl(document.querySelector<HTMLInputElement>('input[name="forwardPort"]')!)
        await click(getButton('Create proxy host'))
        await waitFor(
            () =>
                document.body.textContent?.includes('This domain is listed more than once.') ??
                false,
        )
        expect(createProxyHostHandlerMock).not.toHaveBeenCalled()

        await setControlValue(duplicateDomain, 'other.example.com')
        await blurControl(duplicateDomain)
        await click(getButton('Create proxy host'))
        await waitFor(() => createProxyHostHandlerMock.mock.calls.length === 1)
        await waitForToast('success')
        expect(createProxyHostHandlerMock).toHaveBeenCalledWith({
            data: {
                domains: ['example.com', 'other.example.com'],
                enabled: true,
                forwardHost: 'backend.internal',
                forwardPort: 80,
                forwardScheme: 'http',
            },
        })
        expect(document.body.textContent).not.toContain('This domain is listed more than once.')
    })

    test('keeps create modal open after a transport failure without exposing diagnostics', async () => {
        createProxyHostHandlerMock.mockRejectedValueOnce(new Error('private SQL diagnostics'))
        await render(withQueryClient(<FormHarness mode="create" />))
        const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
        await setControlValue(domain, 'new.example.com')
        await blurControl(domain)
        const forwardHost = document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!
        await setControlValue(forwardHost, 'backend.internal')
        await blurControl(forwardHost)
        await blurControl(document.querySelector<HTMLInputElement>('input[name="forwardPort"]')!)
        await click(getButton('Create proxy host'))
        await waitForToast('error')
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
        expect(document.body.textContent).not.toContain('private SQL diagnostics')
    })

    test('keeps edit modal open after a transport failure and preserves the changed value', async () => {
        updateProxyHostHandlerMock.mockRejectedValueOnce(new Error('private SQL diagnostics'))
        await render(withQueryClient(<FormHarness mode="edit" proxyHost={enabledHost} />))
        const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
        await setControlValue(domain, 'changed.example.com')
        await blurControl(domain)
        await click(getButton('Save changes'))
        await waitForToast('error')
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
        expect(domain.value).toBe('changed.example.com')
        expect(document.body.textContent).not.toContain('private SQL diagnostics')
    })

    test('keeps status read-only without the matching transition permission', async () => {
        await render(
            withQueryClient(
                <FormHarness mode="edit" proxyHost={enabledHost} canEnable canDisable={false} />,
            ),
        )
        const checkbox = document.querySelector<HTMLInputElement>('input[name="enabled"]')!
        expect(checkbox.disabled).toBeTrue()
        expect(document.body.textContent).toContain(
            'You do not have permission to change this proxy host’s saved status.',
        )
    })
    test('keeps modal open and blocks invalid submission with inline validation', async () => {
        await render(withQueryClient(<FormHarness mode="create" />))
        await click(getButton('Create proxy host'))
        await waitFor(() => document.body.textContent?.includes('Enter a valid DNS name') ?? false)
        expect(createProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
        expect(document.body.textContent).not.toContain('SQL')
    })

    test('opens edit with values, preserves them after a domain error, and submits update', async () => {
        updateProxyHostHandlerMock.mockResolvedValueOnce({
            success: false,
            message: 'admin.proxyHosts.errors.domain_conflict',
        })
        await render(withQueryClient(<FormHarness mode="edit" proxyHost={enabledHost} />))
        const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
        expect(domain.value).toBe('app.example.com')
        await setControlValue(domain, 'changed.example.com')
        await click(getButton('Save changes'))
        await waitForToast('error')
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
        expect(domain.value).toBe('changed.example.com')
        updateProxyHostHandlerMock.mockResolvedValueOnce({
            success: true,
            message: 'admin.proxyHosts.messages.updated',
            runtimeStatus: 'applied',
        })
        await click(getButton('Save changes'))
        await waitFor(() => updateProxyHostHandlerMock.mock.calls.length === 2)
        await waitForToast('success')
        await waitFor(() => document.querySelector('[role="dialog"]') === null)
    })

    test('requires a second confirmation before disabling an enabled host and preserves edit on cancel', async () => {
        await render(withQueryClient(<FormHarness mode="edit" proxyHost={enabledHost} />))
        await click(document.querySelector<HTMLInputElement>('input[name="enabled"]')!)
        await click(getButton('Save changes'))
        await waitFor(() => document.body.textContent?.includes('Disable proxy host?') ?? false)
        expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
        await click(getLastButton('Cancel'))
        await waitFor(() => !document.body.textContent?.includes('Disable proxy host?'))
        expect(document.body.textContent).toContain('Edit proxy host')
        expect(
            document.querySelector<HTMLInputElement>('input[name="enabled"]')?.checked,
        ).toBeFalse()
        await click(getButton('Save changes'))
        await click(getButton('Save and disable'))
        await waitFor(() => updateProxyHostHandlerMock.mock.calls.length === 1)
        await waitForToast('success')
        expect(updateProxyHostHandlerMock.mock.calls[0]?.[0]).toMatchObject({
            data: { enabled: false, proxyHostId: enabledHost.id },
        })
    })

    test('supports domain removal and keeps a minimum one domain', async () => {
        await render(withQueryClient(<FormHarness mode="edit" proxyHost={enabledHost} />))
        expect(document.querySelectorAll('input[name^="domains["]').length).toBe(3)
        await click(getButton('Remove domain 2'))
        expect(document.querySelectorAll('input[name^="domains["]').length).toBe(2)
        await click(getButton('Remove domain 2'))
        await click(getButton('Remove domain 1'))
        expect(document.querySelectorAll('input[name^="domains["]').length).toBe(1)
    })
})

describe('ProxyHost confirmation and mutation flows', () => {
    test('cancels and confirms delete without exposing transport diagnostics', async () => {
        await renderPage(allManagementPermissions)
        await waitFor(() => getRows().length === 2)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Delete'))
        expect(document.body.textContent).toContain('Delete proxy host?')
        await click(getButton('Cancel'))
        expect(deleteProxyHostHandlerMock).not.toHaveBeenCalled()
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Delete'))
        await click(getButton('Delete proxy host'))
        await waitFor(() => deleteProxyHostHandlerMock.mock.calls.length === 1)
        await waitForToast('success')
        expect(deleteProxyHostHandlerMock).toHaveBeenCalledWith({
            data: { proxyHostId: enabledHost.id },
        })
    })

    test('cancels and confirms disable, while enable is direct', async () => {
        await renderPage(allManagementPermissions)
        await waitFor(() => getRows().length === 2)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Disable'))
        expect(document.body.textContent).toContain('Disable proxy host?')
        await click(getButton('Cancel'))
        expect(disableProxyHostHandlerMock).not.toHaveBeenCalled()
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Disable'))
        await click(getButton('Disable proxy host'))
        await waitFor(() => disableProxyHostHandlerMock.mock.calls.length === 1)
        await waitForToast('success')
        await openMenu(getButton('Open actions for disabled.example.com'))
        await click(getMenuItem('Enable'))
        await waitFor(() => enableProxyHostHandlerMock.mock.calls.length === 1)
        await waitForToast('success')
        expect(enableProxyHostHandlerMock).toHaveBeenCalledWith({
            data: { proxyHostId: disabledHost.id },
        })
    })

    test.each(['domain', 'transport'] as const)(
        'keeps row data after %s mutation failure',
        async (failure) => {
            if (failure === 'domain') {
                deleteProxyHostHandlerMock.mockResolvedValueOnce({
                    success: false,
                    message: 'admin.proxyHosts.errors.domain_conflict',
                })
            } else {
                deleteProxyHostHandlerMock.mockRejectedValueOnce(
                    new Error('private SQL diagnostics'),
                )
            }
            await renderPage(allManagementPermissions)
            await waitFor(() => getRows().length === 2)
            await openMenu(getButton('Open actions for app.example.com'))
            await click(getMenuItem('Delete'))
            await click(getButton('Delete proxy host'))
            await waitForToast('error')
            expect(document.body.textContent).toContain('app.example.com')
            expect(document.body.textContent).not.toContain('private SQL diagnostics')
            expect(document.querySelector('[data-toast-tone="success"]')).toBeNull()
        },
    )
})

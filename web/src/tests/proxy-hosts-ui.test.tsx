import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { QueryClient as QueryClientInstance } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { PERMISSIONS } from '../config/permissions.config'
import type { ProxyHostSummary } from '../shared/Types/proxy-hosts.types'
import type { CertificateSummary } from '../shared/Types/certificates.types'
import type {
    ProxyHostActionResult,
    ProxyRuntimeSyncStatus,
    ProxyHostConfigEditorData,
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

function hostConfig(settings: string, domain = 'app.example.com'): string {
    return [
        'server {',
        '    listen 8080;',
        '    server_name ' + domain + ';',
        '',
        '    # rentnerproxy: host HTTP settings begin',
        ...(settings ? settings.split('\n').map((line) => '    ' + line) : []),
        '    # rentnerproxy: host HTTP settings end',
        '',
        '    location / {',
        '        proxy_pass http://192.0.2.10:8080;',
        '    }',
        '}',
        '',
    ].join('\n')
}

const editorBaseRevision = 'sha256:' + '1'.repeat(64)
const editorFixture: ProxyHostConfigEditorData = {
    proxyHostId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54019',
    hostLabel: 'app.example.com',
    enabled: true,
    commonSettingsSource: 'client_max_body_size 10m;',
    baseRevision: editorBaseRevision,
    settingsSource: 'proxy_read_timeout 90s;',
    active: { config: hostConfig('proxy_read_timeout 90s;'), revision: editorBaseRevision },
    generated: { config: hostConfig('proxy_read_timeout 90s;'), revision: editorBaseRevision },
    defaults: { config: hostConfig(''), revision: null },
}
const getProxyHostConfigEditorHandlerMock = mock(
    async (_input: unknown): Promise<ProxyHostConfigEditorData> => editorFixture,
)
const previewProxyHostConfigEditorHandlerMock = mock(async (_input: unknown) => ({
    config: hostConfig('proxy_read_timeout 120s;'),
    revision: editorBaseRevision,
}))
const saveProxyHostConfigEditorHandlerMock = mock(
    async (_input: unknown): Promise<ProxyHostActionResult> => ({
        success: true,
        message: 'admin.proxyHosts.config.saved',
        runtimeStatus: 'applied',
    }),
)
const resetProxyHostConfigEditorHandlerMock = mock(
    async (_input: unknown): Promise<ProxyHostActionResult> => ({
        success: true,
        message: 'admin.proxyHosts.config.reset',
        runtimeStatus: 'applied',
    }),
)

mock.module('../features/Admin/ProxyHostManagement/server', () => ({
    getProxyHostConfigEditorHandler: getProxyHostConfigEditorHandlerMock,
    previewProxyHostConfigEditorHandler: previewProxyHostConfigEditorHandlerMock,
    saveProxyHostConfigEditorHandler: saveProxyHostConfigEditorHandlerMock,
    resetProxyHostConfigEditorHandler: resetProxyHostConfigEditorHandlerMock,
    createProxyHostHandler: createProxyHostHandlerMock,
    deleteProxyHostHandler: deleteProxyHostHandlerMock,
    disableProxyHostHandler: disableProxyHostHandlerMock,
    enableProxyHostHandler: enableProxyHostHandlerMock,
    getProxyRuntimeStatusHandler: getProxyRuntimeStatusHandlerMock,
    getProxyHostsHandler: getProxyHostsHandlerMock,
    applyProxyConfigurationHandler: applyProxyConfigurationHandlerMock,
    updateProxyHostHandler: updateProxyHostHandlerMock,
}))

const getAssignableCertificatesHandlerMock = mock(async (): Promise<CertificateSummary[]> => [])
const requestCertificateHandlerMock = mock(async () => ({
    success: true,
    message: 'admin.certificates.messages.requested',
}))

mock.module('../features/Admin/CertificateManagement/server', () => ({
    getAssignableCertificatesHandler: getAssignableCertificatesHandlerMock,
    requestCertificateHandler: requestCertificateHandlerMock,
}))

const assignableTrustedCa = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54051',
    name: 'HomeLab Root CA',
    subject: 'CN=HomeLab Root CA',
    issuer: 'CN=HomeLab Root CA',
    fingerprintSha256: 'sha256:' + 'a'.repeat(64),
    notBefore: new Date('2026-01-01T00:00:00Z'),
    notAfter: new Date('2036-01-01T00:00:00Z'),
    assignedHostCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
}
const getAssignableTrustedCasHandlerMock = mock(async () => [assignableTrustedCa])
mock.module('../features/Admin/TrustedCaManagement/server', () => ({
    getAssignableTrustedCasHandler: getAssignableTrustedCasHandlerMock,
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
    certificateId: null,
    forceHttps: false,
    verifyUpstreamTls: true,
    upstreamTlsServerName: null,
    trustedCaId: null,
}
const assignableCertificate: CertificateSummary = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54022',
    name: 'Edge TLS',
    domains: ['app.example.com'],
    source: 'acme',
    environment: 'staging',
    status: 'valid',
    operation: 'idle',
    issuedAt: new Date('2026-01-01T12:00:00Z'),
    expiresAt: new Date('2026-04-01T12:00:00Z'),
    issuer: 'Pebble',
    fingerprint: 'SHA256:fixture',
    lastErrorCode: null,
    assignedHostCount: 0,
    createdAt: new Date('2026-01-01T12:00:00Z'),
    updatedAt: new Date('2026-01-01T12:00:00Z'),
}

const disabledHost: ProxyHostSummary = {
    ...enabledHost,
    createdAt: new Date('2026-01-03T12:00:00Z'),
    domains: ['disabled.example.com'],
    verifyUpstreamTls: false,
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
            expect(condition(), 'Timed out waiting for: ' + condition.toString()).toBeTrue()
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
    getProxyHostConfigEditorHandlerMock.mockReset().mockResolvedValue(editorFixture)
    previewProxyHostConfigEditorHandlerMock.mockReset().mockResolvedValue({
        config: hostConfig('proxy_read_timeout 120s;'),
        revision: editorBaseRevision,
    })
    saveProxyHostConfigEditorHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.proxyHosts.config.saved',
        runtimeStatus: 'applied',
    })
    resetProxyHostConfigEditorHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.proxyHosts.config.reset',
        runtimeStatus: 'applied',
    })
    getProxyHostsHandlerMock.mockReset()
    getProxyRuntimeStatusHandlerMock.mockReset()
    applyProxyConfigurationHandlerMock.mockReset()
    createProxyHostHandlerMock.mockReset()
    updateProxyHostHandlerMock.mockReset()
    deleteProxyHostHandlerMock.mockReset()
    enableProxyHostHandlerMock.mockReset()
    disableProxyHostHandlerMock.mockReset()
    getAssignableCertificatesHandlerMock.mockReset().mockResolvedValue([])
    getAssignableTrustedCasHandlerMock.mockReset().mockResolvedValue([assignableTrustedCa])
    requestCertificateHandlerMock
        .mockReset()
        .mockResolvedValue({ success: true, message: 'admin.certificates.messages.requested' })
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

    getAssignableCertificatesHandlerMock.mockResolvedValue([])
})

afterEach(async () => {
    if (activeRoot) {
        await act(async () => activeRoot?.unmount())
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
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
    test('Viewer can inspect Config but has no mutation actions', async () => {
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        await waitFor(() => getRows().length === 2)
        expect(document.body.textContent).not.toContain('Add proxy host')
        await openMenu(getButton('Open actions for app.example.com'))
        expect(
            [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
        ).toEqual(['Config'])
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
    canAssignCertificates = false,
    mode,
    proxyHost,
}: {
    canDisable?: boolean
    canEnable?: boolean
    canAssignCertificates?: boolean
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
            canAssignCertificates={canAssignCertificates}
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
                certificateId: null,
                forceHttps: false,
                verifyUpstreamTls: true,
                upstreamTlsServerName: null,
                trustedCaId: null,
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
                certificateId: null,
                forceHttps: false,
                verifyUpstreamTls: true,
                upstreamTlsServerName: null,
                trustedCaId: null,
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

test('assigns a usable certificate and enables HTTPS redirect', async () => {
    getAssignableCertificatesHandlerMock.mockResolvedValueOnce([assignableCertificate])
    await render(withQueryClient(<FormHarness mode="create" canAssignCertificates />))
    const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
    await setControlValue(domain, 'app.example.com')
    await blurControl(domain)
    await waitFor(() => document.querySelector('button[aria-label="TLS certificate"]') !== null)
    await chooseSelectOption('TLS certificate', 'Edge TLS \u00b7 app.example.com')
    const checkboxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(checkboxes.length).toBeGreaterThanOrEqual(2)
    const forceHttps = document.querySelector<HTMLInputElement>('input[id$="forceHttps"]')!
    await waitFor(() => forceHttps.disabled === false)
    await act(async () => {
        forceHttps.click()
        await Promise.resolve()
    })
    const forwardHost = document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!
    await setControlValue(forwardHost, 'backend.internal')
    await blurControl(forwardHost)
    await click(getButton('Create proxy host'))
    await waitFor(() => createProxyHostHandlerMock.mock.calls.length === 1)
    expect(createProxyHostHandlerMock).toHaveBeenCalledWith({
        data: {
            domains: ['app.example.com'],
            enabled: true,
            certificateId: assignableCertificate.id,
            forceHttps: true,
            verifyUpstreamTls: true,
            upstreamTlsServerName: null,
            trustedCaId: null,
            forwardHost: 'backend.internal',
            forwardPort: 80,
            forwardScheme: 'http',
        },
    })
    await waitForToast('success')
})
describe('Proxy host configuration editor', () => {
    const editPermissions = [
        PERMISSIONS.PROXY_HOSTS_VIEW,
        PERMISSIONS.PROXY_HOSTS_UPDATE,
        PERMISSIONS.PROXY_HOSTS_APPLY,
    ] as const

    async function openEditor(
        permissions: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][] = editPermissions,
    ): Promise<HTMLTextAreaElement> {
        await renderPage(permissions)
        await waitFor(() => getRows().length === 2)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Config'))
        await waitFor(
            () =>
                document.querySelector<HTMLTextAreaElement>('#proxy-settings-source')?.value ===
                hostConfig(editorFixture.settingsSource),
        )
        return document.querySelector<HTMLTextAreaElement>('#proxy-settings-source')!
    }

    test('loads config only when opened and gives viewers a safe read-only source', async () => {
        getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            ...editorFixture,
            active: { config: '<script>unsafe()</script>', revision: editorBaseRevision },
        })
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_ADVANCED_CONFIG])
        await waitFor(() => getRows().length === 2)
        expect(getProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Config'))
        await waitFor(() => document.querySelector('#proxy-settings-source') !== null)
        const editor = document.querySelector<HTMLTextAreaElement>('#proxy-settings-source')!
        expect(editor.readOnly).toBeTrue()
        expect(getProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: { proxyHostId: enabledHost.id },
        })
        expect(document.body.textContent).toContain('Config · app.example.com')
        await click(getButton('Active config'))
        expect(document.body.textContent).toContain('<script>unsafe()</script>')
        expect(document.querySelector('script')).toBeNull()
        await click(getButton('Generated defaults'))
        expect(editor.value).toBe(hostConfig(''))
        expect(document.body.textContent).not.toContain('Save and apply')
        expect(document.body.textContent).not.toContain('Restore defaults')
    })

    test('update permission without apply permission cannot edit settings', async () => {
        const editor = await openEditor([
            PERMISSIONS.PROXY_HOSTS_VIEW,
            PERMISSIONS.PROXY_HOSTS_UPDATE,
        ])
        expect(editor.readOnly).toBeTrue()
        expect(document.body.textContent).not.toContain('Save and apply')
        expect(saveProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
    })

    test('rejects raw directives locally and preview never saves settings', async () => {
        const editor = await openEditor()
        await setControlValue(editor, hostConfig('include /tmp/arbitrary.conf;'))
        await click(getButton('Save and apply'))
        expect(saveProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain('Invalid setting on line 1')

        await setControlValue(editor, hostConfig('proxy_read_timeout 120s;'))
        await click(getLastButton('Preview'))
        await waitFor(() => previewProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(previewProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: { proxyHostId: enabledHost.id, settingsSource: 'proxy_read_timeout 120s;' },
        })
        await waitFor(
            () => editor.readOnly && editor.value === hostConfig('proxy_read_timeout 120s;'),
        )
        expect(saveProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
        expect(resetProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()

        await click(getButton('Edit config'))
        await setControlValue(editor, hostConfig('proxy_read_timeout 121s;'))
        expect(editor.value).toBe(hostConfig('proxy_read_timeout 121s;'))
        expect(getButton('Preview').disabled).toBeTrue()
    })

    test('keeps dirty drafts and their original revision across background refresh and conflicts', async () => {
        const editor = await openEditor()
        await setControlValue(editor, hostConfig('proxy_read_timeout 120s;'))
        await act(async () => {
            activeQueryClient!.setQueryData(
                proxyHostManagementQueryKeys.hostConfigEditor(enabledHost.id),
                {
                    ...editorFixture,
                    baseRevision: 'sha256:' + '2'.repeat(64),
                    settingsSource: 'proxy_read_timeout 180s;',
                    defaults: { config: hostConfig('', 'changed.example.com'), revision: null },
                },
            )
        })
        expect(editor.value).toBe(hostConfig('proxy_read_timeout 120s;'))
        saveProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            success: false,
            message: 'admin.proxyHosts.config.errors.configuration_conflict',
        })
        await click(getButton('Save and apply'))
        await waitFor(() => saveProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(saveProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: {
                proxyHostId: enabledHost.id,
                baseRevision: editorBaseRevision,
                settingsSource: 'proxy_read_timeout 120s;',
            },
        })
        expect(editor.value).toBe(hostConfig('proxy_read_timeout 120s;'))
        expect(document.querySelector('#proxy-settings-source')).not.toBeNull()
        expect(document.body.textContent).toContain('The saved configuration changed')
        await waitForToast('error')
    })

    test('reports saved but unapplied changes as pending and refreshes runtime status', async () => {
        const editor = await openEditor()
        await setControlValue(editor, hostConfig('proxy_read_timeout 120s;'))
        saveProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            success: true,
            message: 'admin.proxyHosts.runtime.savedPending',
            runtimeStatus: 'pending',
        })
        await click(getButton('Save and apply'))
        await waitFor(() => document.querySelector('#proxy-settings-source') === null)
        await waitForToast('warning')
        expect(getProxyRuntimeStatusHandlerMock.mock.calls.length).toBeGreaterThanOrEqual(2)
        expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
    })

    test('requires confirmation before resetting only the custom settings', async () => {
        await openEditor()
        await click(getButton('Restore defaults'))
        expect(resetProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain('Your hosts and forwarding targets are kept.')
        expect(document.body.textContent).toContain(
            'Other hosts and shared defaults remain unchanged.',
        )
        await click(getButton('Restore and apply'))
        await waitFor(() => resetProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(resetProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: { proxyHostId: enabledHost.id, baseRevision: editorBaseRevision },
        })
        await waitFor(() => document.querySelector('#proxy-settings-source') === null)
        expect(deleteProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
        await waitForToast('success')
    })

    test('protects generated host, target and listener directives from raw edits', async () => {
        const editor = await openEditor()
        await setControlValue(
            editor,
            editor.value.replace(
                'proxy_pass http://192.0.2.10:8080;',
                'proxy_pass http://another.internal;',
            ),
        )
        await click(getButton('Save and apply'))
        expect(saveProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain(
            'Change only the settings between the marked lines',
        )
        await click(getLastButton('Preview'))
        expect(previewProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
    })

    test('switches color presets without altering the source or saving', async () => {
        const editor = await openEditor()
        expect(document.querySelectorAll('[data-nginx-token="directive"]').length).toBeGreaterThan(
            0,
        )
        expect(document.querySelectorAll('[data-nginx-token="comment"]').length).toBeGreaterThan(0)
        expect(document.querySelector('[data-editor-theme="system"]')).not.toBeNull()
        await click(getButton('Midnight'))
        expect(document.querySelector('[data-editor-theme="midnight"]')).not.toBeNull()
        expect(getButton('Midnight').getAttribute('aria-pressed')).toBe('true')
        await click(getButton('Paper'))
        expect(document.querySelector('[data-editor-theme="paper"]')).not.toBeNull()
        expect(editor.value).toBe(hostConfig(editorFixture.settingsSource))
        expect(saveProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
    })

    test('opens another host with its own cache, source and disabled-state save', async () => {
        await openEditor()
        await click(getButton('Cancel'))
        await waitFor(() => document.querySelector('[role="dialog"]') === null)
        // Radix restores focus asynchronously after the dialog unmounts.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
        const otherData = {
            ...editorFixture,
            proxyHostId: disabledHost.id,
            hostLabel: disabledHost.domains[0]!,
            enabled: false,
            settingsSource: 'proxy_read_timeout 45s;',
            active: null,
            defaults: { config: hostConfig('', 'disabled.example.com'), revision: null },
        }
        getProxyHostConfigEditorHandlerMock.mockResolvedValue(otherData)
        await openMenu(getButton('Open actions for disabled.example.com'))
        await click(getMenuItem('Config'))
        await waitFor(
            () =>
                document.querySelector<HTMLTextAreaElement>('#proxy-settings-source')?.value ===
                hostConfig('proxy_read_timeout 45s;', 'disabled.example.com'),
        )
        expect(getProxyHostConfigEditorHandlerMock).toHaveBeenLastCalledWith({
            data: { proxyHostId: disabledHost.id },
        })
        expect(document.body.textContent).toContain('This proxy is saved as disabled.')
        expect(document.body.textContent).toContain('Config · disabled.example.com')
        await click(getButton('Save for later'))
        await waitFor(() => saveProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(saveProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: {
                proxyHostId: disabledHost.id,
                baseRevision: editorBaseRevision,
                settingsSource: 'proxy_read_timeout 45s;',
            },
        })
        await waitFor(() => document.querySelector('#proxy-settings-source') === null)
        await waitForToast('success')
    })

    test('keeps an offline draft valid when the controller returns in the background', async () => {
        getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            ...editorFixture,
            active: null,
            defaults: null,
            generated: null,
        })
        await renderPage(editPermissions)
        await waitFor(() => getRows().length === 2)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Config'))
        await waitFor(
            () =>
                document.querySelector<HTMLTextAreaElement>('#proxy-settings-source')?.value ===
                editorFixture.settingsSource,
        )
        const editor = document.querySelector<HTMLTextAreaElement>('#proxy-settings-source')!
        await setControlValue(editor, 'proxy_read_timeout 120s;')
        await act(async () => {
            activeQueryClient!.setQueryData(
                proxyHostManagementQueryKeys.hostConfigEditor(enabledHost.id),
                editorFixture,
            )
        })
        expect(editor.value).toBe('proxy_read_timeout 120s;')
        await click(getButton('Save and apply'))
        await waitFor(() => saveProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(saveProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: {
                proxyHostId: enabledHost.id,
                baseRevision: editorBaseRevision,
                settingsSource: 'proxy_read_timeout 120s;',
            },
        })
        await waitFor(() => document.querySelector('#proxy-settings-source') === null)
        await waitForToast('success')
    })
})

describe('Proxy editor explicit reload', () => {
    test('keeps the draft on cancel and reloads source plus revision after confirmation', async () => {
        await renderPage([
            PERMISSIONS.PROXY_HOSTS_VIEW,
            PERMISSIONS.PROXY_HOSTS_UPDATE,
            PERMISSIONS.PROXY_HOSTS_APPLY,
        ])
        await waitFor(() => getRows().length === 2)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Config'))
        await waitFor(() => document.querySelector('#proxy-settings-source') !== null)
        const editor = document.querySelector<HTMLTextAreaElement>('#proxy-settings-source')!
        await setControlValue(editor, hostConfig('proxy_read_timeout 120s;'))
        await click(getButton('Reload'))
        expect(getProxyHostConfigEditorHandlerMock).toHaveBeenCalledTimes(1)
        await click(getLastButton('Cancel'))
        expect(editor.value).toBe(hostConfig('proxy_read_timeout 120s;'))

        const nextRevision = 'sha256:' + '2'.repeat(64)
        getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            ...editorFixture,
            baseRevision: nextRevision,
            settingsSource: 'proxy_read_timeout 180s;',
        })
        await click(getButton('Reload'))
        await click(getButton('Discard draft and reload'))
        await waitFor(() => editor.value === hostConfig('proxy_read_timeout 180s;'))
        await click(getButton('Save and apply'))
        await waitFor(() => saveProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(saveProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: {
                proxyHostId: enabledHost.id,
                baseRevision: nextRevision,
                settingsSource: 'proxy_read_timeout 180s;',
            },
        })
        await waitForToast('success')
    })
})

type AdvancedProxyHostConfigEditorData = ProxyHostConfigEditorData & {
    readonly advancedConfig?: string
}

const advancedEditorSource =
    '# trusted expert setting\nlocation = /custom-health {\n    return 200 "healthy";\n}\n'
const advancedEditorFixture = {
    ...editorFixture,
    advancedConfig: advancedEditorSource,
} satisfies AdvancedProxyHostConfigEditorData

const expertViewPermissions = [
    PERMISSIONS.PROXY_HOSTS_VIEW,
    PERMISSIONS.PROXY_HOSTS_ADVANCED_CONFIG,
] as const
const expertEditPermissions = [
    PERMISSIONS.PROXY_HOSTS_VIEW,
    PERMISSIONS.PROXY_HOSTS_UPDATE,
    PERMISSIONS.PROXY_HOSTS_APPLY,
    PERMISSIONS.PROXY_HOSTS_ADVANCED_CONFIG,
] as const

describe('Proxy host advanced configuration editor', () => {
    async function openAdvancedEditor(
        permissions: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][] = expertEditPermissions,
    ): Promise<HTMLTextAreaElement> {
        getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce(advancedEditorFixture)
        await renderPage(permissions)
        await waitFor(() => getRows().length === 2)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Config'))
        await waitFor(() => document.querySelector('#proxy-advanced-config-source') !== null)
        return document.querySelector<HTMLTextAreaElement>('#proxy-advanced-config-source')!
    }

    test('hides raw configuration for non-experts even if a DTO accidentally contains it', async () => {
        getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce(advancedEditorFixture)
        await renderPage([
            PERMISSIONS.PROXY_HOSTS_VIEW,
            PERMISSIONS.PROXY_HOSTS_UPDATE,
            PERMISSIONS.PROXY_HOSTS_APPLY,
        ])
        await waitFor(() => getRows().length === 2)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Config'))
        await waitFor(() => document.querySelector('#proxy-settings-source') !== null)

        expect(document.querySelector('#proxy-advanced-config-source')).toBeNull()
        expect(document.body.textContent).not.toContain(advancedEditorSource)
    })

    test('shows the raw editor read-only to experts without update and apply', async () => {
        const editor = await openAdvancedEditor(expertViewPermissions)

        expect(editor.readOnly).toBeTrue()
        expect(document.body.textContent).toContain('Custom Nginx Configuration')
        expect(document.body.textContent).not.toContain('Save and apply')
        expect(document.body.textContent).not.toContain('Restore defaults')
    })

    test('preserves expert text with locations and quotes in preview and save payloads', async () => {
        const editor = await openAdvancedEditor()
        const source =
            '# quoted value\nlocation = /health?probe=1 {\n    add_header X-Test "enabled value" always;\n    return 200 "healthy";\n}\n'

        await setControlValue(editor, source)
        await click(getLastButton('Preview'))
        await waitFor(() => previewProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(previewProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: {
                proxyHostId: enabledHost.id,
                settingsSource: editorFixture.settingsSource,
                advancedConfig: source,
            },
        })

        await click(getButton('Edit config'))
        await click(getButton('Save and apply'))
        await waitFor(() => saveProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(saveProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: {
                proxyHostId: enabledHost.id,
                baseRevision: editorBaseRevision,
                settingsSource: editorFixture.settingsSource,
                advancedConfig: source,
            },
        })
        await waitFor(() => document.querySelector('[role=dialog]') === null)
        await waitForToast('success')
    })

    test('rejects oversized UTF-8 and NUL raw values before preview or save', async () => {
        const editor = await openAdvancedEditor()
        const oversized = '😀'.repeat(16_385)

        await setControlValue(editor, oversized)
        await click(getButton('Save and apply'))
        expect(saveProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
        expect(previewProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain(
            'The custom configuration exceeds the 64 KiB UTF-8 size limit.',
        )

        await setControlValue(editor, 'safe\0value')
        await click(getLastButton('Preview'))
        expect(previewProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain(
            'Invalid advanced configuration: enter valid text without NUL characters.',
        )
    })

    test('keeps a raw-only draft and its original revision during a background refresh', async () => {
        const editor = await openAdvancedEditor()
        const draft = 'location = /raw-only {\n    return 200 "draft";\n}\n'
        const nextRevision = 'sha256:' + '2'.repeat(64)

        await setControlValue(editor, draft)
        await act(async () => {
            activeQueryClient!.setQueryData(
                proxyHostManagementQueryKeys.hostConfigEditor(enabledHost.id, true),
                {
                    ...advancedEditorFixture,
                    baseRevision: nextRevision,
                    advancedConfig: 'location = /server-value { return 200 "new"; }',
                },
            )
        })
        expect(editor.value).toBe(draft)

        await click(getButton('Save and apply'))
        await waitFor(() => saveProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(saveProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: {
                proxyHostId: enabledHost.id,
                baseRevision: editorBaseRevision,
                settingsSource: editorFixture.settingsSource,
                advancedConfig: draft,
            },
        })
        await waitFor(() => document.querySelector('[role=dialog]') === null)
        await waitForToast('success')
    })

    test('requires explicit reload confirmation for raw-only changes', async () => {
        const editor = await openAdvancedEditor()
        const draft = 'location = /reload-test { return 200 "draft"; }'
        await setControlValue(editor, draft)

        await click(getButton('Reload'))
        expect(getProxyHostConfigEditorHandlerMock).toHaveBeenCalledTimes(1)
        expect(document.body.textContent).toContain('Reload saved configuration?')
        await click(getLastButton('Cancel'))
        expect(editor.value).toBe(draft)

        const latest = {
            ...advancedEditorFixture,
            advancedConfig: 'location = /reload-test { return 200 "latest"; }',
        }
        getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce(latest)
        await click(getButton('Reload'))
        await click(getButton('Discard draft and reload'))
        await waitFor(
            () =>
                document.querySelector<HTMLTextAreaElement>('#proxy-advanced-config-source')
                    ?.value === latest.advancedConfig,
        )
    })

    test('sends resetAdvancedConfig only for an expert reset', async () => {
        await openAdvancedEditor()
        await click(getButton('Restore defaults'))
        await click(getButton('Restore and apply'))
        await waitFor(() => resetProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(resetProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: {
                proxyHostId: enabledHost.id,
                baseRevision: editorBaseRevision,
                resetAdvancedConfig: true,
            },
        })
        await waitFor(() => document.querySelector('[role=dialog]') === null)
        await waitForToast('success')
    })

    test('omits resetAdvancedConfig for an existing non-expert reset', async () => {
        getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce(advancedEditorFixture)
        await renderPage([
            PERMISSIONS.PROXY_HOSTS_VIEW,
            PERMISSIONS.PROXY_HOSTS_UPDATE,
            PERMISSIONS.PROXY_HOSTS_APPLY,
        ])
        await waitFor(() => getRows().length === 2)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Config'))
        await waitFor(() => document.querySelector('#proxy-settings-source') !== null)
        await click(getButton('Restore defaults'))
        await click(getButton('Restore and apply'))
        await waitFor(() => resetProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(resetProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: { proxyHostId: enabledHost.id, baseRevision: editorBaseRevision },
        })
        await waitFor(() => document.querySelector('[role=dialog]') === null)
        await waitForToast('success')
    })

    test('drops raw draft and preview when permission changes while the modal is open', async () => {
        const editor = await openAdvancedEditor()
        const privateSource = 'location = /permission-change { return 200 "private"; }'
        await setControlValue(editor, privateSource)
        await click(getLastButton('Preview'))
        await waitFor(() => document.body.textContent?.includes('Preview') === true)
        await click(getButton('Edit config'))

        await act(async () => {
            activeRoot?.render(
                <TooltipProvider>
                    <ToastProvider>
                        <QueryClientProvider client={activeQueryClient!}>
                            <ProxyHostManagementPage
                                permissions={[
                                    PERMISSIONS.PROXY_HOSTS_VIEW,
                                    PERMISSIONS.PROXY_HOSTS_UPDATE,
                                    PERMISSIONS.PROXY_HOSTS_APPLY,
                                ]}
                            />
                        </QueryClientProvider>
                    </ToastProvider>
                </TooltipProvider>,
            )
            await Promise.resolve()
        })
        await waitFor(() => document.querySelector('#proxy-advanced-config-source') === null)
        expect(document.body.textContent).not.toContain(privateSource)
    })
})

describe('HTTPS upstream TLS controls', () => {
    async function openForm(
        proxyHost?: ProxyHostSummary,
        language: 'en' | 'de' | 'es' | 'fr' = 'en',
    ) {
        await render(
            withQueryClient(
                withTestLanguage(
                    <ProxyHostFormModal
                        canEnable
                        canDisable
                        mode={proxyHost ? 'edit' : 'create'}
                        open
                        onOpenChange={() => {}}
                        onSuccess={() => {}}
                        {...(proxyHost ? { proxyHost } : {})}
                    />,
                    language,
                ),
            ),
        )
        await waitFor(() => document.querySelector('input[name="forwardHost"]') !== null)
        await waitFor(() => getAssignableTrustedCasHandlerMock.mock.calls.length > 0)
    }

    async function prepareNewHttpsHost() {
        await openForm()
        await setControlValue(document.querySelector('input[name="domains[0]"]')!, 'secure.test')
        await setControlValue(document.querySelector('input[name="forwardHost"]')!, 'backend.test')
        await setControlValue(document.querySelector('input[name="forwardPort"]')!, '8443')
        await chooseSelectOption('Forward scheme', 'HTTPS')
        await waitFor(() => document.querySelector('input[name="verifyUpstreamTls"]') !== null)
    }

    test('HTTP hides TLS controls and new HTTPS hosts default to verification with system trust', async () => {
        await openForm()
        expect(document.querySelector('input[name="verifyUpstreamTls"]')).toBeNull()
        expect(document.querySelector('input[name="upstreamTlsServerName"]')).toBeNull()
        await setControlValue(document.querySelector('input[name="forwardHost"]')!, 'backend.test')
        await chooseSelectOption('Forward scheme', 'HTTPS')
        const verify = document.querySelector<HTMLInputElement>('input[name="verifyUpstreamTls"]')!
        expect(verify.checked).toBeTrue()
        expect(document.body.textContent).toContain('System trust store')
        expect(
            document.querySelector<HTMLInputElement>('input[name="upstreamTlsServerName"]')!
                .placeholder,
        ).toBe('Automatic: backend.test')
        expect(document.body.textContent).not.toContain(
            'Upstream certificate verification is disabled.',
        )
    })

    test('submits the secure default without manual TLS configuration', async () => {
        await prepareNewHttpsHost()
        await click(getLastButton('Create proxy host'))
        await waitFor(() => createProxyHostHandlerMock.mock.calls.length === 1)
        expect(createProxyHostHandlerMock.mock.calls[0]![0]).toMatchObject({
            data: {
                forwardScheme: 'https',
                verifyUpstreamTls: true,
                upstreamTlsServerName: null,
                trustedCaId: null,
            },
        })
    })

    test('custom CA and DNS identity override are submitted for an IP connection target', async () => {
        await prepareNewHttpsHost()
        await setControlValue(document.querySelector('input[name="forwardHost"]')!, '10.10.0.25')
        expect(document.body.textContent).toContain(
            'Enter the DNS name from the upstream certificate',
        )
        await setControlValue(
            document.querySelector('input[name="upstreamTlsServerName"]')!,
            'backend.test',
        )
        await waitFor(() => !getButton('Trusted CA').disabled)
        await chooseSelectOption('Trusted CA', 'HomeLab Root CA')
        await click(getLastButton('Create proxy host'))
        await waitFor(() => createProxyHostHandlerMock.mock.calls.length === 1)
        expect(createProxyHostHandlerMock.mock.calls[0]![0]).toMatchObject({
            data: {
                forwardHost: '10.10.0.25',
                verifyUpstreamTls: true,
                upstreamTlsServerName: 'backend.test',
                trustedCaId: assignableTrustedCa.id,
            },
        })
    })

    test('an explicit insecure override warns, removes CA selection and keeps DNS SNI', async () => {
        await prepareNewHttpsHost()
        await setControlValue(
            document.querySelector('input[name="upstreamTlsServerName"]')!,
            'virtual.backend.test',
        )
        await chooseSelectOption('Trusted CA', 'HomeLab Root CA')
        await act(async () => {
            document.querySelector<HTMLInputElement>('input[name="verifyUpstreamTls"]')!.click()
        })
        expect(document.body.textContent).toContain(
            'Upstream certificate verification is disabled.',
        )
        expect(document.querySelector('button[aria-label="Trusted CA"]')).toBeNull()
        expect(
            document.querySelector<HTMLInputElement>('input[name="upstreamTlsServerName"]')!.value,
        ).toBe('virtual.backend.test')
        await click(getLastButton('Create proxy host'))
        await waitFor(() => createProxyHostHandlerMock.mock.calls.length === 1)
        expect(createProxyHostHandlerMock.mock.calls[0]![0]).toMatchObject({
            data: {
                verifyUpstreamTls: false,
                upstreamTlsServerName: 'virtual.backend.test',
                trustedCaId: null,
            },
        })
    })

    test('existing insecure HTTPS hosts retain their explicit opt-out in the editor', async () => {
        await openForm({
            ...enabledHost,
            forwardScheme: 'https',
            forwardHost: 'backend.test',
            verifyUpstreamTls: false,
        })
        expect(
            document.querySelector<HTMLInputElement>('input[name="verifyUpstreamTls"]')!.checked,
        ).toBeFalse()
        expect(document.body.textContent).toContain(
            'Upstream certificate verification is disabled.',
        )
        await click(getLastButton('Save'))
        await waitFor(() => updateProxyHostHandlerMock.mock.calls.length === 1)
        expect(updateProxyHostHandlerMock.mock.calls[0]![0]).toMatchObject({
            data: { verifyUpstreamTls: false },
        })
    })

    test('the list flags existing insecure HTTPS hosts without claiming upstream health', async () => {
        getProxyHostsHandlerMock.mockResolvedValue([
            { ...enabledHost, forwardScheme: 'https', verifyUpstreamTls: false },
        ])
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        await waitFor(
            () => document.body.textContent?.includes('Certificate verification disabled') === true,
        )
        expect(document.body.textContent).not.toContain('Upstream healthy')
    })

    test('HTTPS to HTTP clears TLS fields and returning to HTTPS restores verification', async () => {
        await openForm({
            ...enabledHost,
            forwardScheme: 'https',
            verifyUpstreamTls: false,
            upstreamTlsServerName: 'backend.test',
        })
        await chooseSelectOption('Forward scheme', 'HTTP')
        expect(document.querySelector('input[name="verifyUpstreamTls"]')).toBeNull()
        await chooseSelectOption('Forward scheme', 'HTTPS')
        expect(
            document.querySelector<HTMLInputElement>('input[name="verifyUpstreamTls"]')!.checked,
        ).toBeTrue()
        expect(
            document.querySelector<HTMLInputElement>('input[name="upstreamTlsServerName"]')!.value,
        ).toBe('')
        expect(document.body.textContent).toContain('System trust store')
    })

    test('CA loading failure retains the assigned CA instead of switching to system trust', async () => {
        getAssignableTrustedCasHandlerMock.mockRejectedValue(new Error('test unavailable'))
        await openForm({
            ...enabledHost,
            forwardScheme: 'https',
            forwardHost: 'backend.test',
            verifyUpstreamTls: true,
            trustedCaId: assignableTrustedCa.id,
        })
        await waitFor(
            () => document.body.textContent?.includes('Trusted CAs could not be loaded.') === true,
        )
        expect(getButton('Trusted CA').disabled).toBeTrue()
        expect(getButton('Trusted CA').textContent).toContain('Selected CA unavailable')
        await click(getLastButton('Save'))
        await waitFor(() => updateProxyHostHandlerMock.mock.calls.length === 1)
        expect(updateProxyHostHandlerMock.mock.calls[0]![0]).toMatchObject({
            data: { trustedCaId: assignableTrustedCa.id, verifyUpstreamTls: true },
        })
    })

    for (const [language, warning] of [
        ['en', 'The connection is encrypted, but RentnerProxy cannot verify the identity'],
        ['de', 'Die Verbindung ist verschlüsselt, aber RentnerProxy kann die Identität'],
        ['es', 'La conexión está cifrada, pero RentnerProxy no puede verificar la identidad'],
        ['fr', 'La connexion est chiffrée, mais RentnerProxy ne peut pas vérifier l’identité'],
    ] as const) {
        test('insecure warning is localized in ' + language, async () => {
            await openForm(
                {
                    ...enabledHost,
                    forwardScheme: 'https',
                    forwardHost: 'backend.test',
                    verifyUpstreamTls: false,
                },
                language,
            )
            expect(document.body.textContent).toContain(warning)
        })
    }
})

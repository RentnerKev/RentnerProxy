import BrowserCacheFields from '@/features/Admin/ProxyHostManagement/Components/BrowserCacheFields/index.tsx'
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { QueryClient as QueryClientInstance } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'

import { PERMISSIONS, RUNTIME_SUPPORT_REPORT_PERMISSIONS } from '@/config/permissions.config.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { CertificateSummary } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import type { AccessPolicySummary } from '@/lib/AccessPolicies/Types/access-policies.types.ts'
import type {
    ProxyHttpSettings,
    ProxyHostActionResult,
    ProxyRuntimeSyncStatus,
    ProxyHostConfigEditorData,
    ProxyConfigEditorData,
} from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import type {
    CertificateJobActionResult,
    CertificateJobSummary,
} from '@/lib/CertificateJobs/Types/certificate-jobs.types.ts'
import { proxyHostManagementQueryKeys } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { certificateJobProgressQueryKeys } from '@/lib/Admin/ProxyHostManagement/CertificateJobs/certificateJobsCache.ts'
import withTestLanguage, { withLanguageRoot } from '@/tests/Helpers/withTestLanguage.tsx'
import { filterHostPage } from '@/lib/HostTags/hostList.ts'
import { hostListQuerySchema } from '@/features/Admin/HostTags/validation.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()

const { QueryClient, QueryClientProvider, QueryObserver } = await import('@tanstack/react-query')
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: withTestPageAlerts, openPageAlerts } =
    await import('@/tests/Helpers/withTestPageAlerts.tsx')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { ToastProvider, toast } = await import('@rentnerkev/toasts')

const loadProxyHostPageFixture = mock(async (): Promise<ProxyHostSummary[]> => [])
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

function hostConfig(settings: number | undefined, domain = 'app.example.com'): string {
    const timeout = settings
    return JSON.stringify(
        {
            http: {
                [domain]: {
                    routes: [
                        { handle: [{ handler: 'reverse_proxy', upstreams: ['192.0.2.10:8080'] }] },
                    ],
                    ...(timeout ? { proxyReadTimeoutSeconds: timeout } : {}),
                },
            },
        },
        null,
        2,
    )
}

const editorBaseRevision = 'sha256:' + '1'.repeat(64)
const editorFixture: ProxyHostConfigEditorData = {
    proxyHostId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54019',
    hostLabel: 'app.example.com',
    enabled: true,
    baseRevision: editorBaseRevision,
    settings: { proxyReadTimeoutSeconds: 90 },
    inheritedSettings: {
        clientMaxBodySizeBytes: 1_048_576,
        proxyConnectTimeoutSeconds: 10,
        proxyReadTimeoutSeconds: 60,
    },
    active: { config: hostConfig(90), revision: editorBaseRevision },
}
const globalEditorFixture: ProxyConfigEditorData = {
    baseRevision: editorBaseRevision,
    settings: { proxyReadTimeoutSeconds: 90 },
    active: { config: hostConfig(90), revision: editorBaseRevision },
    defaults: { config: hostConfig(undefined), revision: null },
}
const getProxyHostConfigEditorHandlerMock = mock(
    async (_input: unknown): Promise<ProxyHostConfigEditorData> => editorFixture,
)
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
const getProxyConfigEditorHandlerMock = mock(
    async (): Promise<ProxyConfigEditorData> => globalEditorFixture,
)
const saveProxyConfigEditorHandlerMock = mock(
    async (_input: unknown): Promise<ProxyHostActionResult> => ({
        success: true,
        message: 'admin.proxyHosts.config.saved',
        runtimeStatus: 'applied',
    }),
)
const resetProxyConfigEditorHandlerMock = mock(async (): Promise<ProxyHostActionResult> => ({
    success: true,
    message: 'admin.proxyHosts.config.reset',
    runtimeStatus: 'applied',
}))

mock.module('@/features/Admin/ProxyHostManagement/middleware.ts', () => ({
    getProxyConfigEditorHandler: getProxyConfigEditorHandlerMock,
    saveProxyConfigEditorHandler: saveProxyConfigEditorHandlerMock,
    resetProxyConfigEditorHandler: resetProxyConfigEditorHandlerMock,
    getProxyHostConfigEditorHandler: getProxyHostConfigEditorHandlerMock,
    saveProxyHostConfigEditorHandler: saveProxyHostConfigEditorHandlerMock,
    resetProxyHostConfigEditorHandler: resetProxyHostConfigEditorHandlerMock,
    createProxyHostHandler: createProxyHostHandlerMock,
    deleteProxyHostHandler: deleteProxyHostHandlerMock,
    disableProxyHostHandler: disableProxyHostHandlerMock,
    enableProxyHostHandler: enableProxyHostHandlerMock,
    getProxyRuntimeStatusHandler: getProxyRuntimeStatusHandlerMock,
    getProxyHostPageHandler: async ({ data }: { data: unknown }) =>
        filterHostPage(await loadProxyHostPageFixture(), [], hostListQuerySchema.parse(data), {
            enabled: 'Enabled',
            disabled: 'Disabled',
        }),
    applyProxyConfigurationHandler: applyProxyConfigurationHandlerMock,
    updateProxyHostHandler: updateProxyHostHandlerMock,
}))

mock.module('@/features/Admin/HostTags/middleware.ts', () => ({
    getHostTagCatalogHandler: async () => ({ revision: 0, tags: [] }),
    mutateHostTagHandler: async () => ({ success: true, value: { revision: 1, tags: [] } }),
}))

const getAssignableCertificatesHandlerMock = mock(async (): Promise<CertificateSummary[]> => [])
const getAssignableAccessPoliciesHandlerMock = mock(async (): Promise<AccessPolicySummary[]> => [])
mock.module('@/features/Admin/AccessPolicyManagement/middleware.ts', () => ({
    getAssignableAccessPoliciesHandler: getAssignableAccessPoliciesHandlerMock,
}))
const requestCertificateHandlerMock = mock(async () => ({
    success: true,
    message: 'admin.certificates.messages.requested',
}))

const createProxyHostWithCertificateHandlerMock = mock(
    async (_input: unknown): Promise<CertificateJobActionResult> => ({
        success: false,
        message: 'admin.proxyHosts.certificateJob.errors.actionFailed',
    }),
)
const updateProxyHostWithCertificateHandlerMock = mock(
    async (_input: unknown): Promise<CertificateJobActionResult> => ({
        success: false,
        message: 'admin.proxyHosts.certificateJob.errors.actionFailed',
    }),
)
const requestProxyHostCertificateHandlerMock = mock(
    async (_input: unknown): Promise<CertificateJobActionResult> => ({
        success: false,
        message: 'admin.proxyHosts.certificateJob.errors.actionFailed',
    }),
)
const retryCertificateJobHandlerMock = mock(
    async (_input: unknown): Promise<CertificateJobActionResult> => ({
        success: false,
        message: 'admin.proxyHosts.certificateJob.errors.actionFailed',
    }),
)
const getCertificateJobProgressHandlerMock = mock(async (): Promise<CertificateJobSummary[]> => [])

mock.module('@/features/Admin/ProxyHostManagement/CertificateJobs/middleware.ts', () => ({
    createProxyHostWithCertificateHandler: createProxyHostWithCertificateHandlerMock,
    updateProxyHostWithCertificateHandler: updateProxyHostWithCertificateHandlerMock,
    requestProxyHostCertificateHandler: requestProxyHostCertificateHandlerMock,
    retryCertificateJobHandler: retryCertificateJobHandlerMock,
    getCertificateJobProgressHandler: getCertificateJobProgressHandlerMock,
}))

let dnsProvidersUnavailable = false
const getCertificateDnsProviders = mock(async () => {
    if (dnsProvidersUnavailable) throw new Error('offline')
    return [
        {
            id: 'cloudflare' as const,
            capabilities: {
                zoneDiscovery: true,
                txtCreate: true,
                txtCleanup: true,
                addressRecordTypes: ['A', 'AAAA'] as const,
                proxyOptions: 'cloudflare' as const,
            },
        },
    ]
})
mock.module('@/features/Admin/CertificateManagement/middleware.ts', () => ({
    inspectCertificateDnsSetupHandler: mock(async () => ({
        success: false,
        message: 'admin.certificates.errors.actionFailed',
    })),
    checkManualDnsHandler: mock(async () => ({
        success: false,
        message: 'admin.certificates.errors.actionFailed',
    })),
    getCertificatesHandler: mock(async () => []),
    continueManualDnsHandler: mock(async () => ({
        success: true as const,
        message: 'admin.certificates.manualDns.checking',
    })),
    cancelDelegatedCertificateHandler: mock(async () => ({
        success: true,
        message: 'admin.certificates.delegatedDns.cancelling',
    })),
    cancelManualDnsHandler: mock(async () => ({
        success: true as const,
        message: 'admin.certificates.manualDns.cancelled',
    })),
    getCertificateDnsProvidersHandler: getCertificateDnsProviders,
    getCertificateDnsConnectionsHandler: mock(async () => [
        {
            id: '0198d98a-0000-7000-8000-000000000002',
            provider: 'cloudflare',
            name: 'Shared Cloudflare',
            zones: [{ id: 'a'.repeat(32), name: 'example.com' }],
            verification: {
                status: 'connected',
                checkedAt: '2026-10-01T00:00:00Z',
                zoneIds: ['a'.repeat(32)],
                error: null,
            },
        },
    ]),
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
mock.module('@/features/Admin/TrustedCaManagement/middleware.ts', () => ({
    getAssignableTrustedCasHandler: getAssignableTrustedCasHandlerMock,
}))

mock.module('@/features/Admin/RuntimeDiagnostics/middleware.ts', () => ({
    exportRuntimeSupportReportHandler: mock(() => {
        throw new Error('Unexpected support report download in proxy-host tests.')
    }),
}))

const { default: ProxyHostManagementPage } =
    await import('@/features/Admin/ProxyHostManagement/index.tsx')
const { default: ProxyHostFormModal } =
    await import('@/features/Admin/ProxyHostManagement/Components/ProxyHostFormModal/index.tsx')
const { default: ProxyHostTableActions } =
    await import('@/features/Admin/ProxyHostManagement/Components/ProxyHostsTable/Components/ProxyHostTableActions.tsx')
const { default: ProxyRuntimeStatusPanel } =
    await import('@/features/Admin/ProxyHostManagement/Components/ProxyRuntimeStatusPanel.tsx')
const { default: CertificateJobProgressObserver } =
    await import('@/features/Admin/ProxyHostManagement/CertificateJobs/CertificateJobProgressObserver.tsx')

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
    candidate: null,
    dnsCleanupPending: false,
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

function certificateJobFixture(
    overrides: Partial<CertificateJobSummary> = {},
): CertificateJobSummary {
    return {
        id: '0198f2f0-0000-7000-8000-000000000081',
        proxyHostId: enabledHost.id,
        certificateId: assignableCertificate.id,
        domains: ['app.example.com'],
        stage: 'preparing',
        controllerStage: null,
        lastErrorCode: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...overrides,
    }
}

async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = withLanguageRoot(createRoot(container))
    await act(async () => {
        activeRoot?.render(
            <TooltipProvider>
                <ToastProvider
                    {...TOAST_PROVIDER_PROPS}
                    locale="en"
                    messages={{
                        regionLabel: 'Notification',
                        closeNotification: 'Dismiss notification',
                        copyError: 'Copy error message',
                        errorCopied: 'Copied',
                    }}
                >
                    {withTestPageAlerts(element)}
                </ToastProvider>
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
            new MouseEvent('click', {
                bubbles: true,
                button: 0,
                cancelable: true,
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
    await waitFor(() => document.querySelector(`.rentnerproxy-toast-${tone}`) !== null)
    await waitFor(() => {
        return [...document.querySelectorAll('[aria-live]')].some(
            (announcement) => message === undefined || announcement.textContent?.includes(message),
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

function getCheckbox(label: string, root: ParentNode = document): HTMLInputElement {
    const checkbox = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
        (input) => input.closest('label')?.textContent?.includes(label),
    )
    expect(checkbox).toBeDefined()
    return checkbox!
}

function getHostTab(label: string): HTMLButtonElement {
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (candidate) => candidate.textContent?.trim().startsWith(label),
    )
    expect(tab).toBeDefined()
    return tab!
}

function getHostPanel(label: string): HTMLElement {
    return document.getElementById(getHostTab(label).getAttribute('aria-controls')!)!
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

function domainOrder(): Array<string | undefined> {
    return getRows().map((row) => row.querySelector('td')?.textContent?.trim())
}

function getLastButton(label: string): HTMLButtonElement {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
        (candidate) => candidate.textContent?.trim().includes(label),
    )
    expect(buttons.length).toBeGreaterThan(0)
    return buttons.at(-1)!
}

beforeEach(() => {
    dnsProvidersUnavailable = false
    getCertificateDnsProviders.mockClear()
    toast.dismissAll()
    window.sessionStorage.clear()
    getProxyConfigEditorHandlerMock.mockReset().mockResolvedValue(globalEditorFixture)
    saveProxyConfigEditorHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.proxyHosts.config.saved',
        runtimeStatus: 'applied',
    })
    resetProxyConfigEditorHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.proxyHosts.config.reset',
        runtimeStatus: 'applied',
    })
    getProxyHostConfigEditorHandlerMock.mockReset().mockResolvedValue(editorFixture)
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
    loadProxyHostPageFixture.mockReset()
    getProxyRuntimeStatusHandlerMock.mockReset()
    applyProxyConfigurationHandlerMock.mockReset()
    createProxyHostHandlerMock.mockReset()
    updateProxyHostHandlerMock.mockReset()
    deleteProxyHostHandlerMock.mockReset()
    enableProxyHostHandlerMock.mockReset()
    disableProxyHostHandlerMock.mockReset()
    getAssignableCertificatesHandlerMock.mockReset().mockResolvedValue([])
    getAssignableAccessPoliciesHandlerMock.mockReset().mockResolvedValue([])
    getAssignableTrustedCasHandlerMock.mockReset().mockResolvedValue([assignableTrustedCa])
    requestCertificateHandlerMock
        .mockReset()
        .mockResolvedValue({ success: true, message: 'admin.certificates.messages.requested' })
    createProxyHostWithCertificateHandlerMock.mockReset().mockResolvedValue({
        success: false,
        message: 'admin.proxyHosts.certificateJob.errors.actionFailed',
    })
    updateProxyHostWithCertificateHandlerMock.mockReset().mockResolvedValue({
        success: false,
        message: 'admin.proxyHosts.certificateJob.errors.actionFailed',
    })
    requestProxyHostCertificateHandlerMock.mockReset().mockResolvedValue({
        success: false,
        message: 'admin.proxyHosts.certificateJob.errors.actionFailed',
    })
    retryCertificateJobHandlerMock.mockReset().mockResolvedValue({
        success: false,
        message: 'admin.proxyHosts.certificateJob.errors.actionFailed',
    })
    getCertificateJobProgressHandlerMock.mockReset().mockResolvedValue([])
    loadProxyHostPageFixture.mockResolvedValue([enabledHost, disabledHost])
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

const certificateProgressPermissions = [
    PERMISSIONS.PROXY_HOSTS_VIEW,
    PERMISSIONS.CERTIFICATES_VIEW,
    PERMISSIONS.CERTIFICATES_ISSUE,
] as const

function PermissionHarness() {
    const [permissions, setPermissions] = useState<
        readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][]
    >(certificateProgressPermissions)
    return (
        <>
            <button type="button" onClick={() => setPermissions([])}>
                Remove proxy host permission
            </button>
            <CertificateJobProgressObserver permissions={permissions} />
        </>
    )
}

function NavigationHarness() {
    const [route, setRoute] = useState<'hosts' | 'certificates'>('hosts')
    return (
        <>
            <CertificateJobProgressObserver permissions={certificateProgressPermissions} />
            <button type="button" onClick={() => setRoute('certificates')}>
                Open certificates
            </button>
            <div data-testid="route-content">{route}</div>
        </>
    )
}

function getTaskToasts(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('.rentnerproxy-toast')].filter((toastNode) =>
        toastNode.textContent?.includes('Certificate request'),
    )
}

async function renderCertificateProgress(jobs: readonly CertificateJobSummary[]) {
    getCertificateJobProgressHandlerMock.mockResolvedValue([...jobs])
    return render(
        withQueryClient(
            <CertificateJobProgressObserver permissions={certificateProgressPermissions} />,
        ),
    )
}

describe('background certificate job progress', () => {
    test('recovers multiple active jobs after reload with independent real stages', async () => {
        await renderCertificateProgress([
            certificateJobFixture(),
            certificateJobFixture({
                id: '0198f2f0-0000-7000-8000-000000000082',
                proxyHostId: disabledHost.id,
                domains: ['disabled.example.com'],
                stage: 'issuing',
                controllerStage: 'waiting_for_validation',
            }),
        ])

        await waitFor(() => getTaskToasts().length === 2)
        const text = getTaskToasts()
            .map((toastNode) => toastNode.textContent ?? '')
            .join('\n')
        expect(text).toContain('app.example.com')
        expect(text).toContain('Queued')
        expect(text).toContain('disabled.example.com')
        expect(text).toContain('Waiting for validation')
        expect(text).not.toMatch(/\d+%/u)
        for (const toastNode of getTaskToasts()) {
            expect(toastNode.classList.contains('rentnerproxy-toast-info')).toBeTrue()
            expect(toastNode.querySelector('[aria-label="Dismiss notification"]')).not.toBeNull()
            expect(toastNode.querySelector('[data-testid="toast-progress"]')).toBeNull()
        }
    })

    test('turns an active job into a brief success notification', async () => {
        const active = certificateJobFixture()
        await renderCertificateProgress([active])
        await waitFor(() => getTaskToasts().length === 1)

        await act(async () => {
            activeQueryClient?.setQueryData(certificateJobProgressQueryKeys.all, [
                { ...active, stage: 'applied', controllerStage: 'applied', updatedAt: new Date() },
            ])
            await Promise.resolve()
        })

        await waitFor(
            () => getTaskToasts()[0]?.classList.contains('rentnerproxy-toast-success') === true,
        )
        const toastNode = getTaskToasts()[0]!
        expect(toastNode.textContent).toContain('Certificate assigned successfully.')
        expect(toastNode.querySelector('[aria-label="Dismiss notification"]')).not.toBeNull()
        expect(toastNode.querySelector('[data-testid="toast-progress"]')).not.toBeNull()
        await waitFor(() => getTaskToasts().length === 0, 6_000)
    }, 8_000)

    test('keeps failure details visible until the user dismisses them', async () => {
        const failed = certificateJobFixture({
            stage: 'failed',
            controllerStage: 'failed',
            lastErrorCode: 'controller_unavailable',
        })
        await renderCertificateProgress([failed])
        await waitFor(
            () => getTaskToasts()[0]?.classList.contains('rentnerproxy-toast-error') === true,
        )
        const failedToast = getTaskToasts()[0]!
        expect(failedToast.textContent).toContain('Certificate request')
        expect(failedToast.textContent).toContain('app.example.com')
        expect(failedToast.textContent).toContain('The proxy controller is unavailable.')
        expect(failedToast.querySelector('[data-testid="toast-progress"]')).toBeNull()
        expect(failedToast.querySelector('[aria-label="Dismiss notification"]')).not.toBeNull()
        await click(getButton('Dismiss notification'))
        await waitFor(() => getTaskToasts().length === 0)
    })

    test('restores an authoritative failure after reload and then shows new progress', async () => {
        const failed = certificateJobFixture({
            stage: 'failed',
            controllerStage: 'retry_scheduled',
            lastErrorCode: 'acme_failed',
        })
        await renderCertificateProgress([failed])
        await waitFor(
            () => getTaskToasts()[0]?.classList.contains('rentnerproxy-toast-error') === true,
        )
        await click(getButton('Dismiss notification'))
        await waitFor(() => getTaskToasts().length === 0)

        await act(async () => activeRoot?.unmount())
        activeRoot = null
        activeQueryClient?.clear()
        activeQueryClient = null
        document.body.replaceChildren()

        await renderCertificateProgress([failed])
        await waitFor(() => getCertificateJobProgressHandlerMock.mock.calls.length >= 2)
        await waitFor(
            () => getTaskToasts()[0]?.classList.contains('rentnerproxy-toast-error') === true,
        )

        await act(async () => {
            activeQueryClient?.setQueryData(certificateJobProgressQueryKeys.all, [
                {
                    ...failed,
                    stage: 'preparing',
                    controllerStage: 'queued',
                    lastErrorCode: null,
                    updatedAt: new Date('2026-01-01T00:01:00Z'),
                },
            ])
            await Promise.resolve()
        })
        await waitFor(
            () => getTaskToasts()[0]?.classList.contains('rentnerproxy-toast-info') === true,
        )
        expect(getTaskToasts()[0]?.textContent).toContain('Queued')
    })

    test('dismisses certificate progress when proxy-host viewing permission is removed', async () => {
        const failed = certificateJobFixture({
            stage: 'failed',
            controllerStage: 'failed',
            lastErrorCode: 'controller_unavailable',
        })
        getCertificateJobProgressHandlerMock.mockResolvedValue([failed])

        await render(withQueryClient(<PermissionHarness />))
        await waitFor(
            () => getTaskToasts()[0]?.classList.contains('rentnerproxy-toast-error') === true,
        )

        await click(getButton('Remove proxy host permission'))
        await waitFor(() => getTaskToasts().length === 0)
    })

    test('keeps active progress visible while route content changes', async () => {
        getCertificateJobProgressHandlerMock.mockResolvedValue([certificateJobFixture()])

        await render(withQueryClient(<NavigationHarness />))
        await waitFor(() => getTaskToasts().length === 1)
        await click(getButton('Open certificates'))
        await waitFor(
            () =>
                document.querySelector('[data-testid="route-content"]')?.textContent ===
                'certificates',
        )
        expect(getTaskToasts()).toHaveLength(1)
        expect(getTaskToasts()[0]?.textContent).toContain('app.example.com')
    })

    test('recovers a terminal failure from an authoritative progress refresh', async () => {
        const active = certificateJobFixture()
        await renderCertificateProgress([active])
        await waitFor(() => getTaskToasts().length === 1)
        getCertificateJobProgressHandlerMock.mockResolvedValue([
            {
                ...active,
                stage: 'failed',
                controllerStage: 'failed',
                lastErrorCode: 'controller_unavailable',
                updatedAt: new Date('2026-01-01T00:01:00Z'),
            },
        ])

        await act(async () => {
            await activeQueryClient?.invalidateQueries({
                queryKey: certificateJobProgressQueryKeys.all,
            })
        })

        await waitFor(
            () => getTaskToasts()[0]?.classList.contains('rentnerproxy-toast-error') === true,
        )
        expect(getTaskToasts()[0]?.textContent).toContain('The proxy controller is unavailable.')
    })

    test('does not replay an already completed success after reload', async () => {
        await renderCertificateProgress([
            certificateJobFixture({
                stage: 'applied',
                controllerStage: 'applied',
                updatedAt: new Date(),
            }),
        ])
        await waitFor(() => getCertificateJobProgressHandlerMock.mock.calls.length === 1)
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
        expect(getTaskToasts()).toHaveLength(0)
    })
})

describe('ProxyHost management table', () => {
    test('keeps tag assignment and its dropdown mounted through background runtime refreshes', async () => {
        await renderPage(allManagementPermissions)
        await waitFor(() => getRows().length === 2)
        await click(getButton('Edit tags for app.example.com'))
        await waitFor(() => document.querySelector('[role="dialog"]') !== null)
        const assignmentDialog = document.querySelector('[role="dialog"]')!
        await waitFor(
            () =>
                assignmentDialog.querySelector<HTMLButtonElement>('button[role="combobox"]')
                    ?.disabled === false,
        )
        const trigger =
            assignmentDialog.querySelector<HTMLButtonElement>('button[role="combobox"]')!
        await act(async () => {
            trigger.dispatchEvent(
                new MouseEvent('click', {
                    bubbles: true,
                    button: 0,
                    cancelable: true,
                }),
            )
        })
        await waitFor(() => document.querySelector('input[placeholder="Search tags"]') !== null)
        const searchInput = document.querySelector('input[placeholder="Search tags"]')!
        await act(async () => {
            await activeQueryClient?.invalidateQueries({
                queryKey: proxyHostManagementQueryKeys.runtimeStatus,
            })
            await new Promise((resolve) => setTimeout(resolve, 30))
        })
        expect(assignmentDialog.isConnected).toBe(true)
        expect(searchInput.isConnected).toBe(true)
        expect(trigger.getAttribute('aria-expanded')).toBe('true')
    })
    test('keeps tag assignment accessible for discovered hosts without editing routing', async () => {
        loadProxyHostPageFixture.mockResolvedValue([
            {
                ...enabledHost,
                discovery: { state: 'managed' },
                tags: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Farm' }],
            },
        ])
        await renderPage(allManagementPermissions)
        await waitFor(() => getRows().length === 1)
        expect(getRows()[0]?.textContent).toContain('Farm')
        await click(getButton('Edit tags for app.example.com'))
        await waitFor(() => document.querySelector('[role="dialog"]') !== null)
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
            'Discovery ownership and routing stay the same',
        )
        expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(applyProxyConfigurationHandlerMock).not.toHaveBeenCalled()
    })
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
        const domainLink = [...document.querySelectorAll<HTMLAnchorElement>('tbody a')].find(
            (link) => link.textContent?.trim() === 'app.example.com',
        )
        expect(domainLink?.getAttribute('href')).toBe('https://app.example.com')
        expect(domainLink?.target).toBe('_blank')
        expect(domainLink?.rel).toBe('noopener noreferrer')
        expect(domainLink?.getAttribute('aria-label')).toBe('Open app.example.com in a new tab')
    })

    test('does not leave certificate job stages in the host status column', async () => {
        loadProxyHostPageFixture.mockResolvedValueOnce([
            {
                ...enabledHost,
                certificateJob: certificateJobFixture({
                    stage: 'applied',
                    controllerStage: 'applied',
                }),
            },
        ])
        await renderPage(allManagementPermissions)
        await waitFor(() => getRows().length === 1)
        expect(getRows()[0]?.textContent).toContain('Enabled')
        expect(getRows()[0]?.textContent).not.toContain('Applied')
        expect(getRows()[0]?.textContent).not.toContain('0198f2f0')
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
        loadProxyHostPageFixture.mockResolvedValue(hosts)
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

    test('searches all domain options and selects an exact domain independently of free text search', async () => {
        const hosts = Array.from({ length: 12 }, (_, index) => ({
            ...enabledHost,
            id: `domain-filter-${index}`,
            domains: [
                index === 11
                    ? 'selected.example.com'
                    : index === 0
                      ? 'sub.selected.example.com'
                      : `host-${index}.example.com`,
            ],
        }))
        loadProxyHostPageFixture.mockResolvedValue(hosts)
        await renderPage(allManagementPermissions)
        await waitFor(() => getRows().length === 10)
        await click(getButton('Filters'))
        await click(getButton('Filter domains…'))
        const domainSearch = document.querySelector<HTMLInputElement>(
            'input[placeholder="Filter domains…"]',
        )!
        await waitFor(() => document.activeElement === domainSearch)
        await setControlValue(domainSearch, 'selected')
        const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
        expect(options.map((option) => option.textContent?.trim())).toEqual([
            'selected.example.com',
            'sub.selected.example.com',
        ])
        await click(
            options.find((option) => option.textContent?.trim() === 'selected.example.com')!,
        )
        await waitFor(() => getRows().length === 1)
        expect(getRows()[0]?.textContent).toContain('selected.example.com')
        expect(getRows()[0]?.textContent).not.toContain('sub.selected.example.com')
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[type="search"]')!,
            'missing',
        )
        await waitFor(() => document.body.textContent?.includes('No proxy hosts match') === true)
        await click(getButton('Reset filters'))
        await waitFor(() => getRows().length === 10)
        expect(document.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('')
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
        loadProxyHostPageFixture.mockResolvedValue(hosts)
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        await waitFor(() => getRows().length === 3)

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
        await waitFor(() => domainOrder()[0] === 'alpha.example.com')
        expect(domainOrder()).toEqual([
            'alpha.example.com',
            'zulu.example.com',
            'middle.example.com',
        ])
    })
    test('shows loading, empty, and filtered-empty states', async () => {
        let resolveHosts: ((hosts: ProxyHostSummary[]) => void) | undefined
        loadProxyHostPageFixture.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveHosts = resolve
                }),
        )
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        expect(document.querySelector('tbody[aria-busy="true"]')).not.toBeNull()
        expect(document.body.textContent).toContain('Loading proxy hosts')
        expect(document.body.textContent).not.toContain('0 proxy hosts')
        expect(document.body.textContent).not.toContain('of 0 proxy hosts')
        expect(document.querySelector('[aria-label="Rows per page"]')).toBeNull()
        resolveHosts?.([])
        await waitFor(() => document.body.textContent?.includes('No proxy hosts yet') ?? false)

        loadProxyHostPageFixture.mockResolvedValueOnce([enabledHost])
        await act(async () => activeRoot?.unmount())
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        await waitFor(() => getRows().length === 1)
        await setControlValue(document.querySelector('input[type="search"]')!, 'missing')
        await waitFor(() => document.body.textContent?.includes('No proxy hosts match') ?? false)
    })
})

describe('ProxyHost permissions and row actions', () => {
    test('Viewer can open Domain check and inspect read-only Config without mutation actions', async () => {
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        await waitFor(() => getRows().length === 2)
        expect(document.body.textContent).not.toContain('Add proxy host')
        await openMenu(getButton('Open actions for app.example.com'))
        expect(
            [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
        ).toEqual(['Domain check', 'Config'])
        await click(getMenuItem('Domain check'))
        await waitFor(() => document.querySelector('[role="dialog"]') !== null)
        const domainCheck = document.querySelector('[role="dialog"]')!
        expect(domainCheck.textContent).toContain('Check how the selected domain behaves')
        expect(domainCheck.textContent).toContain('app.example.com')
        expect(getButton('Run check').disabled).toBeFalse()
        expect(domainCheck.querySelector('[aria-busy="true"]')).toBeNull()
        await click(getButton('Close dialog'))
        await waitFor(() => !domainCheck.isConnected)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Config'))
        await waitFor(
            () => document.body.textContent?.includes('You can view the configuration.') === true,
        )
        const config = document.querySelector('[role="dialog"]')!
        expect(config.textContent).toContain('Editing requires both update and apply permissions.')
        expect(config.textContent).not.toContain('Save changes')
        expect(config.textContent).not.toContain('Restore defaults')
        expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(deleteProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(enableProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(disableProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(saveProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
        expect(resetProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
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

    test('moves page load failures into the navbar and clears them after retry', async () => {
        loadProxyHostPageFixture.mockRejectedValueOnce(new Error('private controller diagnostics'))
        const container = await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        await waitFor(() => document.querySelector('button[data-severity="error"]') !== null)
        expect(container.textContent).not.toContain('Proxy hosts are unavailable')
        const details = await openPageAlerts()
        expect(details.textContent).toContain(
            'The saved proxy hosts could not be loaded. Try again.',
        )
        expect(document.body.textContent).not.toContain('private controller diagnostics')
        await click(getButton('Try again'))
        await waitFor(() => getRows().length === 2)
        expect(document.querySelector('button[data-severity]')).toBeNull()
    })

    test('keeps configuration and support download as adjacent explained icon actions', async () => {
        const container = await renderPage(RUNTIME_SUPPORT_REPORT_PERMISSIONS)
        await waitFor(() => getRows().length === 2)
        const config = getButton('Caddy config')
        const support = getButton('Download support report')
        expect(config.textContent).toBe('')
        expect(support.textContent).toBe('')
        expect(config.parentElement).toBe(support.parentElement)
        expect(container.textContent).not.toContain('Includes only versions, status and counts')
        await act(async () => {
            config.focus()
            await new Promise((resolve) => setTimeout(resolve, 100))
        })
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
            'Adjust shared HTTP settings',
        )
    })

    test('hides synchronized runtime status and its apply action', async () => {
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW])
        await waitFor(() => getRows().length === 2)
        expect(document.body.textContent).not.toContain('Proxy runtime synchronized')
        expect(document.body.textContent).not.toContain('Apply changes')
    })

    test('does not show an unavailable runtime while status is pending', async () => {
        await render(
            withTestLanguage(
                <ProxyRuntimeStatusPanel
                    canApply
                    isApplying={false}
                    isRetrying
                    onApply={() => undefined}
                    onRetry={() => undefined}
                    status={undefined}
                />,
            ),
        )
        expect(document.body.textContent).not.toContain('Proxy runtime unavailable.')
    })

    test('keeps cached runtime status available in the navbar during a refresh', async () => {
        await render(
            withTestLanguage(
                <ProxyRuntimeStatusPanel
                    canApply
                    isApplying={false}
                    isRetrying
                    onApply={() => undefined}
                    onRetry={() => undefined}
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
        expect(document.querySelector('button[data-severity]')?.getAttribute('data-severity')).toBe(
            'warning',
        )
        await openPageAlerts()
        expect(document.body.textContent).toContain('Saved changes are waiting to be applied.')
        expect(document.body.textContent).not.toContain('Proxy runtime unavailable.')
    })

    test('shows a safe runtime failure and retries instead of displaying stale status', async () => {
        const onRetry = mock(() => undefined)
        await render(
            withTestLanguage(
                <ProxyRuntimeStatusPanel
                    canApply
                    isApplying={false}
                    isError
                    isRetrying={false}
                    onApply={() => undefined}
                    onRetry={onRetry}
                    status={{
                        available: true,
                        running: true,
                        activeRevision: 'sha256:same',
                        desiredRevision: 'sha256:same',
                        lastApplyAt: null,
                        state: 'synced',
                    }}
                />,
            ),
        )
        expect(document.querySelector('button[data-severity]')?.getAttribute('data-severity')).toBe(
            'error',
        )
        await openPageAlerts()
        expect(document.body.textContent).toContain('Proxy runtime unavailable.')
        expect(document.body.textContent).not.toContain('Proxy runtime synchronized')
        await click(getButton('Try again'))
        expect(onRetry).toHaveBeenCalledTimes(1)
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
        await openPageAlerts()
        expect(document.body.textContent).toContain('Saved changes are waiting to be applied.')
        expect(getButton('Apply changes')).toBeDefined()
        await click(getButton('Apply changes'))
        expect(onApply).toHaveBeenCalledTimes(1)
    })
})

function FormHarness({
    canConfigureCompression = false,
    canConfigureBrowserCache = false,
    initialGuideOpen = false,
    canDisable = true,
    canEnable = true,
    canAssignCertificates = false,
    canRequestCertificate = false,
    canAssignPolicies = false,
    canApplyResponseCache = false,
    mode,
    proxyHost,
}: {
    canConfigureCompression?: boolean
    canConfigureBrowserCache?: boolean
    initialGuideOpen?: boolean
    canDisable?: boolean
    canEnable?: boolean
    canAssignCertificates?: boolean
    canRequestCertificate?: boolean
    canAssignPolicies?: boolean
    canApplyResponseCache?: boolean
    mode: 'create' | 'edit' | 'duplicate'
    proxyHost?: ProxyHostSummary
}) {
    const [open, setOpen] = useState(true)
    return (
        <ProxyHostFormModal
            canConfigureCompression={canConfigureCompression}
            canConfigureBrowserCache={canConfigureBrowserCache}
            open={open}
            initialGuideOpen={initialGuideOpen}
            mode={mode}
            {...(proxyHost ? { proxyHost } : {})}
            canEnable={canEnable}
            canDisable={canDisable}
            canAssignCertificates={canAssignCertificates}
            canRequestCertificate={canRequestCertificate}
            canAssignPolicies={canAssignPolicies}
            canApplyResponseCache={canApplyResponseCache}
            onOpenChange={setOpen}
            onSuccess={() => setOpen(false)}
        />
    )
}

describe('proxy host form tabs', () => {
    test('opens with only required routing fields and defaults to no certificate', async () => {
        await render(
            withQueryClient(<FormHarness mode="create" canAssignCertificates canAssignPolicies />),
        )
        expect(getHostTab('Basics').getAttribute('aria-selected')).toBe('true')
        expect(getHostPanel('Basics').hidden).toBeFalse()
        for (const label of ['Certificate & HTTPS', 'Access', 'Caching', 'Options']) {
            expect(getHostPanel(label).hidden).toBeTrue()
        }
        expect(getHostPanel('Basics').querySelector('input[name="domains[0]"]')).not.toBeNull()
        expect(getHostPanel('Basics').querySelector('input[name="forwardHost"]')).not.toBeNull()
        expect(getHostPanel('Basics').querySelector('input[name="forwardPort"]')).not.toBeNull()
        expect(getHostPanel('Basics').textContent).not.toContain('TLS certificate')
        expect(getHostPanel('Basics').textContent).not.toContain('Browser cache')
        await click(getHostTab('Certificate & HTTPS'))
        expect(getButton('TLS certificate').textContent).toContain('No certificate')
        expect(createProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(createProxyHostWithCertificateHandlerMock).not.toHaveBeenCalled()
    })

    test('navigates with arrow keys, Home and End without submitting', async () => {
        await render(
            withQueryClient(<FormHarness mode="create" canAssignCertificates canAssignPolicies />),
        )
        for (const [current, key, next] of [
            ['Basics', 'ArrowRight', 'Certificate & HTTPS'],
            ['Certificate & HTTPS', 'End', 'Options'],
            ['Options', 'ArrowRight', 'Basics'],
            ['Basics', 'ArrowLeft', 'Options'],
            ['Options', 'Home', 'Basics'],
        ] as const) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- Each navigation depends on the preceding selected tab.
            await act(async () => {
                getHostTab(current!).focus()
                getHostTab(current!).dispatchEvent(
                    new KeyboardEvent('keydown', { key, bubbles: true }),
                )
            })
            expect(getHostTab(next!).getAttribute('aria-selected')).toBe('true')
            expect(document.activeElement).toBe(getHostTab(next!))
            expect(document.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1)
        }
        expect(createProxyHostHandlerMock).not.toHaveBeenCalled()
    })

    test('blocks proxy-host DNS-01 requests when the provider catalogue is unavailable', async () => {
        dnsProvidersUnavailable = true
        await render(
            withQueryClient(
                <FormHarness mode="create" canAssignCertificates canRequestCertificate />,
            ),
        )
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!,
            'catalogue.example.com',
        )
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!,
            'backend.internal',
        )
        await click(getHostTab('Certificate & HTTPS'))
        await chooseSelectOption('TLS certificate', 'Request with ACME')
        await setControlValue(
            document.querySelector<HTMLInputElement>('#certificate-request-name')!,
            'Catalogue failure',
        )
        await chooseSelectOption('ACME challenge', 'DNS-01 (DNS provider)')
        await click(getButton('Request certificate and save'))
        expect(createProxyHostWithCertificateHandlerMock).not.toHaveBeenCalled()
        await waitFor(() => document.querySelector('.rentnerproxy-toast-error') !== null)
        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
            'Choose a verified connection and a permitted zone.',
        )
        expect(document.querySelector('form [role="alert"]')).toBeNull()
        expect(document.body.textContent).not.toContain('catalogue-secret')
    })

    test('keeps host, certificate and partially edited cache drafts when switching tabs', async () => {
        await render(
            withQueryClient(
                <FormHarness
                    mode="create"
                    canAssignCertificates
                    canRequestCertificate
                    canConfigureBrowserCache
                />,
            ),
        )
        const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
        await setControlValue(domain, 'draft.example.com')
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!,
            'backend.internal',
        )
        await click(getHostTab('Certificate & HTTPS'))
        await chooseSelectOption('TLS certificate', 'Request with ACME')
        await setControlValue(
            document.querySelector<HTMLInputElement>('#certificate-request-name')!,
            'Draft TLS',
        )
        await chooseSelectOption('ACME challenge', 'DNS-01 (DNS provider)')
        await waitFor(() => !getButton('Provider connection').disabled)
        await click(getButton('Provider connection'))
        await waitFor(() => document.querySelector('[role="option"]') !== null)
        await click(
            [...document.querySelectorAll('[role="option"]')].find((option) =>
                option.textContent?.includes('Shared Cloudflare'),
            )!,
        )
        await click(getHostTab('Caching'))
        await click(getCheckbox('Enable browser-cache rules'))
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[placeholder="/assets/app.a1b2.js"]')!,
            '/assets/',
        )
        const age = document.querySelector<HTMLInputElement>('input[id*="-age-"]')!
        await setControlValue(age, '')
        await click(getHostTab('Basics'))
        expect(document.querySelector('input[name="domains[0]"]')).toBe(domain)
        expect(domain.value).toBe('draft.example.com')
        await setControlValue(domain, 'updated.example.com')
        await click(getHostTab('Certificate & HTTPS'))
        expect(document.querySelector<HTMLInputElement>('#certificate-request-name')?.value).toBe(
            'Draft TLS',
        )
        expect(
            document.querySelector<HTMLInputElement>('#certificate-request-domain-0')?.value,
        ).toBe('updated.example.com')
        expect(
            document.querySelector('#certificate-request-dns-connection')?.textContent,
        ).toContain('Shared Cloudflare')
        expect(document.querySelector('#certificate-request-dns-api-token')).toBeNull()
        expect(document.querySelector('#certificate-request-terms')).toBeNull()
        const submit = getButton('Request certificate and save')
        const consent = document.getElementById(submit.getAttribute('aria-describedby')!)!
        expect(consent.textContent).toContain('you accept the ACME terms')
        expect(consent.closest('[hidden]')).toBeNull()
        await click(getHostTab('Caching'))
        expect(document.querySelector('input[id*="-age-"]')).toBe(age)
        expect(age.value).toBe('')
        expect(createProxyHostWithCertificateHandlerMock).not.toHaveBeenCalled()
    })

    test('reveals required routing errors from another tab and focuses the first invalid field', async () => {
        await render(withQueryClient(<FormHarness mode="create" canAssignCertificates />))
        await click(getHostTab('Options'))
        await click(getButton('Save changes'))
        expect(getHostPanel('Basics').hidden).toBeFalse()
        expect(getHostTab('Basics').getAttribute('data-invalid')).toBe('true')
        expect(document.activeElement).toBe(document.querySelector('input[name="domains[0]"]'))
        expect(createProxyHostHandlerMock).not.toHaveBeenCalled()
    })

    test('reveals invalid hidden cache settings without losing the remaining form values', async () => {
        await render(
            withQueryClient(
                <FormHarness mode="edit" proxyHost={enabledHost} canConfigureBrowserCache />,
            ),
        )
        await click(getHostTab('Caching'))
        await click(getCheckbox('Enable browser-cache rules'))
        await click(getHostTab('Basics'))
        await click(getButton('Save changes'))
        expect(getHostPanel('Caching').hidden).toBeFalse()
        expect(getHostTab('Caching').getAttribute('data-invalid')).toBe('true')
        expect(document.activeElement).toBe(
            document.querySelector('input[placeholder="/assets/app.a1b2.js"]'),
        )
        expect(document.querySelector<HTMLInputElement>('input[name="forwardHost"]')?.value).toBe(
            enabledHost.forwardHost,
        )
        expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
    })

    test.each([
        ['paths', '/api/'],
        ['ttl', '0'],
    ] as const)(
        'reveals invalid response-cache %s when saving from another tab',
        async (control, value) => {
            await render(
                withQueryClient(
                    <FormHarness
                        mode="edit"
                        proxyHost={{
                            ...enabledHost,
                            responseCache: { pathPrefixes: ['/assets/'], ttlSeconds: 60 },
                        }}
                        canApplyResponseCache
                    />,
                ),
            )
            await click(getHostTab('Caching'))
            await setControlValue(
                document.querySelector<HTMLInputElement>(
                    `input[id$="-response-cache-${control}"]`,
                )!,
                value,
            )
            await click(getHostTab('Basics'))
            await click(getButton('Save changes'))
            expect(getHostPanel('Caching').hidden).toBeFalse()
            expect(getHostTab('Caching').getAttribute('data-invalid')).toBe('true')
            expect(getHostPanel('Caching').contains(document.activeElement)).toBeTrue()
            expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true')
            expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
            await setControlValue(
                document.querySelector<HTMLInputElement>(
                    `input[id$="-response-cache-${control}"]`,
                )!,
                control === 'paths' ? '/assets/' : '120',
            )
            expect(getHostTab('Caching').getAttribute('data-invalid')).not.toBe('true')
            await click(getButton('Save changes'))
            await waitFor(() => updateProxyHostHandlerMock.mock.calls.length === 1)
            expect(updateProxyHostHandlerMock.mock.calls[0]?.[0]).toMatchObject({
                data: {
                    responseCache: {
                        pathPrefixes: ['/assets/'],
                        ttlSeconds: control === 'ttl' ? 120 : 60,
                    },
                },
            })
        },
    )

    test('can disable an invalid response cache after a rejected submission', async () => {
        await render(
            withQueryClient(
                <FormHarness
                    mode="edit"
                    proxyHost={{
                        ...enabledHost,
                        responseCache: { pathPrefixes: ['/api/'], ttlSeconds: 60 },
                    }}
                    canApplyResponseCache
                />,
            ),
        )
        await click(getButton('Save changes'))
        expect(getHostPanel('Caching').hidden).toBeFalse()
        expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
        await click(document.querySelector('input[id$="-response-cache"]')!)
        expect(getHostTab('Caching').getAttribute('data-invalid')).not.toBe('true')
        await click(getButton('Save changes'))
        await waitFor(() => updateProxyHostHandlerMock.mock.calls.length === 1)
        expect(updateProxyHostHandlerMock.mock.calls[0]?.[0]).toMatchObject({
            data: { responseCache: null },
        })
    })

    test('reveals required upstream TLS settings without access-policy assignment permission', async () => {
        await render(withQueryClient(<FormHarness mode="create" />))
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!,
            'secure.example.com',
        )
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!,
            '192.0.2.10',
        )
        await chooseSelectOption('Forward scheme', 'HTTPS')
        await click(getButton('Save changes'))
        expect(getHostPanel('Access').hidden).toBeFalse()
        expect(document.activeElement).toBe(
            document.querySelector('input[name="upstreamTlsServerName"]'),
        )
        expect(createProxyHostHandlerMock).not.toHaveBeenCalled()
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="upstreamTlsServerName"]')!,
            'backend.internal',
        )
        await click(getButton('Save changes'))
        await waitFor(() => createProxyHostHandlerMock.mock.calls.length === 1)
        expect(createProxyHostHandlerMock.mock.calls[0]?.[0]).toMatchObject({
            data: {
                forwardScheme: 'https',
                verifyUpstreamTls: true,
                upstreamTlsServerName: 'backend.internal',
            },
        })
    })

    test('routes invalid ACME fields back to the certificate tab when saving elsewhere', async () => {
        await render(
            withQueryClient(
                <FormHarness mode="create" canAssignCertificates canRequestCertificate />,
            ),
        )
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!,
            'acme.example.com',
        )
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!,
            'backend.internal',
        )
        await click(getHostTab('Certificate & HTTPS'))
        await chooseSelectOption('TLS certificate', 'Request with ACME')
        await chooseSelectOption('ACME challenge', 'DNS-01 (DNS provider)')
        await click(getHostTab('Basics'))
        await click(getButton('Request certificate and save'))
        expect(getHostPanel('Certificate & HTTPS').hidden).toBeFalse()
        expect(getHostTab('Certificate & HTTPS').getAttribute('data-invalid')).toBe('true')
        expect(document.activeElement).toBe(
            document.querySelector('#certificate-request-dns-connection'),
        )
        expect(createProxyHostWithCertificateHandlerMock).not.toHaveBeenCalled()
    })

    test('accepts ACME terms through the request-and-save action from any tab', async () => {
        createProxyHostWithCertificateHandlerMock.mockResolvedValueOnce({
            success: true,
            message: 'admin.proxyHosts.certificateJob.messages.queued',
            job: certificateJobFixture(),
        })
        await render(
            withQueryClient(
                <FormHarness mode="create" canAssignCertificates canRequestCertificate />,
            ),
        )
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!,
            'acme.example.com',
        )
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!,
            'backend.internal',
        )
        await click(getHostTab('Certificate & HTTPS'))
        await chooseSelectOption('TLS certificate', 'Request with ACME')
        expect(document.querySelector('#certificate-request-terms')).toBeNull()
        expect(createProxyHostWithCertificateHandlerMock).not.toHaveBeenCalled()
        await click(getHostTab('Basics'))
        const submit = getButton('Request certificate and save')
        expect(
            document.getElementById(submit.getAttribute('aria-describedby')!)?.textContent,
        ).toContain('you accept the ACME terms')
        await click(submit)
        await waitFor(() => createProxyHostWithCertificateHandlerMock.mock.calls.length === 1)
        expect(createProxyHostWithCertificateHandlerMock.mock.calls[0]?.[0]).toMatchObject({
            data: {
                host: { domains: ['acme.example.com'] },
                request: { acceptTerms: true, environment: 'production', challengeType: 'http-01' },
            },
        })
    })

    test('keeps certificate issuance behind the existing disable confirmation', async () => {
        await render(
            withQueryClient(
                <FormHarness
                    mode="edit"
                    proxyHost={enabledHost}
                    canAssignCertificates
                    canRequestCertificate
                />,
            ),
        )
        await click(getHostTab('Certificate & HTTPS'))
        await chooseSelectOption('TLS certificate', 'Request with ACME')
        await click(getHostTab('Options'))
        await click(document.querySelector<HTMLInputElement>('input[name="enabled"]')!)
        await click(getButton('Request certificate and save'))
        await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 2)
        expect(updateProxyHostWithCertificateHandlerMock).not.toHaveBeenCalled()
        await click(getLastButton('Cancel'))
        await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 1)
        expect(updateProxyHostWithCertificateHandlerMock).not.toHaveBeenCalled()
        expect(
            document.querySelector<HTMLInputElement>('input[name="enabled"]')?.checked,
        ).toBeFalse()
        await click(getButton('Request certificate and save'))
        await click(getButton('Save and disable'))
        await waitFor(() => updateProxyHostWithCertificateHandlerMock.mock.calls.length === 1)
        expect(updateProxyHostWithCertificateHandlerMock.mock.calls[0]?.[0]).toMatchObject({
            data: { host: { enabled: false }, request: { acceptTerms: true } },
        })
    })
})

describe('ProxyHost form modal', () => {
    test('duplicate opens a blank domain draft and cancel clears it before ordinary creation', async () => {
        const original = structuredClone(enabledHost)
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_CREATE])
        await waitFor(() => getRows().length === 2)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Duplicate proxy host'))
        await waitFor(() => document.querySelector('[role="dialog"]') !== null)
        expect(document.querySelectorAll('input[name^="domains["]')).toHaveLength(1)
        expect(document.querySelector<HTMLInputElement>('input[name="domains[0]"]')?.value).toBe('')
        expect(document.querySelector<HTMLInputElement>('input[name="forwardHost"]')?.value).toBe(
            enabledHost.forwardHost,
        )
        expect(document.querySelector<HTMLInputElement>('input[name="forwardPort"]')?.value).toBe(
            String(enabledHost.forwardPort),
        )
        expect(document.body.textContent).toContain(
            'Separate HTTP settings from the Config editor are not copied.',
        )
        await click(getButton('Cancel'))
        await waitFor(() => document.querySelector('[role="dialog"]') === null)
        expect(createProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(getProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
        expect(enabledHost).toEqual(original)
        await click(getButton('Add proxy host'))
        await waitFor(() => document.querySelector('[role="dialog"]') !== null)
        expect(document.querySelector<HTMLInputElement>('input[name="forwardHost"]')?.value).toBe(
            '',
        )
        expect(document.querySelector<HTMLInputElement>('input[name="forwardPort"]')?.value).toBe(
            '80',
        )
    })

    test('duplicate requires new domains, saves through create and retains pending feedback', async () => {
        createProxyHostHandlerMock.mockResolvedValueOnce({
            success: true,
            runtimeStatus: 'pending',
            message: 'admin.proxyHosts.messages.created',
        })
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_CREATE])
        await waitFor(() => getRows().length === 2)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Duplicate proxy host'))
        await click(getButton('Save changes'))
        await waitFor(() => document.body.textContent?.includes('Enter a valid DNS name') ?? false)
        expect(createProxyHostHandlerMock).not.toHaveBeenCalled()
        const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
        await setControlValue(domain, 'Copy.Example.com')
        await blurControl(domain)
        await click(getButton('Save changes'))
        await waitFor(() => createProxyHostHandlerMock.mock.calls.length === 1)
        expect(createProxyHostHandlerMock).toHaveBeenCalledWith({
            data: {
                domains: ['copy.example.com'],
                certificateId: null,
                forceHttps: false,
                verifyUpstreamTls: true,
                upstreamTlsServerName: null,
                trustedCaId: null,
                enabled: true,
                forwardHost: enabledHost.forwardHost,
                forwardPort: enabledHost.forwardPort,
                forwardScheme: 'http',
            },
        })
        expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(createProxyHostWithCertificateHandlerMock).not.toHaveBeenCalled()
        expect(updateProxyHostWithCertificateHandlerMock).not.toHaveBeenCalled()
        await waitForToast('warning')
        await waitFor(() => document.querySelector('[role="dialog"]') === null)
        expect(enabledHost.domains).toEqual([
            'app.example.com',
            'www.example.com',
            'api.example.com',
        ])
    })

    test.each([
        { accessPolicyId: '0198f2f0-0000-7000-8000-000000000041' },
        { certificateId: assignableCertificate.id },
    ])(
        'cannot duplicate a protected source without its assignment permissions: %j',
        async (protection) => {
            loadProxyHostPageFixture.mockResolvedValue([{ ...enabledHost, ...protection }])
            await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_CREATE])
            await waitFor(() => getRows().length === 1)
            await openMenu(getButton('Open actions for app.example.com'))
            expect(
                [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
            ).not.toContain('Duplicate proxy host')
            expect(createProxyHostHandlerMock).not.toHaveBeenCalled()
        },
    )

    test('duplicate preserves an authorized policy and wildcard certificate without issuing a certificate', async () => {
        const policy: AccessPolicySummary = {
            id: '0198f2f0-0000-7000-8000-000000000041',
            name: 'Protected',
            description: '',
            mode: 'authenticated',
            combination: null,
            ipRules: null,
            forwardAuth: null,
            assignedHostCount: 1,
            basicAuthAccountCount: 1,
            createdAt: enabledHost.createdAt,
            updatedAt: enabledHost.updatedAt,
        }
        const source: ProxyHostSummary = {
            ...enabledHost,
            certificateId: assignableCertificate.id,
            forceHttps: true,
            accessPolicyId: policy.id,
        }
        getAssignableCertificatesHandlerMock.mockResolvedValue([
            { ...assignableCertificate, domains: ['*.example.com'] },
        ])
        getAssignableAccessPoliciesHandlerMock.mockResolvedValue([policy])
        loadProxyHostPageFixture.mockResolvedValue([source])
        await renderPage([
            PERMISSIONS.PROXY_HOSTS_VIEW,
            PERMISSIONS.PROXY_HOSTS_CREATE,
            PERMISSIONS.CERTIFICATES_VIEW,
            PERMISSIONS.ACCESS_POLICIES_ASSIGN,
        ])
        await waitFor(() => getRows().length === 1)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Duplicate proxy host'))
        const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
        await setControlValue(domain, 'secure-copy.example.com')
        await blurControl(domain)
        await waitFor(
            () =>
                document.querySelector<HTMLInputElement>('input[name="forceHttps"]')?.disabled ===
                false,
        )
        await click(getButton('Save changes'))
        await waitFor(() => createProxyHostHandlerMock.mock.calls.length === 1)
        expect(createProxyHostHandlerMock).toHaveBeenCalledWith({
            data: expect.objectContaining({
                domains: ['secure-copy.example.com'],
                certificateId: source.certificateId,
                forceHttps: true,
                accessPolicyId: policy.id,
            }),
        })
        expect(createProxyHostWithCertificateHandlerMock).not.toHaveBeenCalled()
        expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(source.domains).toEqual(enabledHost.domains)
    })

    test.each([
        'admin.proxyHosts.errors.domain_conflict',
        'admin.certificates.errors.domain_mismatch',
    ])(
        'duplicate preserves its draft after a server-side validation failure: %s',
        async (message) => {
            createProxyHostHandlerMock.mockResolvedValueOnce({ success: false, message })
            const source: ProxyHostSummary = {
                ...enabledHost,
                certificateId: assignableCertificate.id,
                forceHttps: true,
            }
            getAssignableCertificatesHandlerMock.mockResolvedValue([assignableCertificate])
            await render(
                withQueryClient(
                    <FormHarness mode="duplicate" proxyHost={source} canAssignCertificates />,
                ),
            )
            const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
            await setControlValue(domain, 'uncovered.example.net')
            await blurControl(domain)
            await click(getButton('Save changes'))
            await waitForToast('error')
            expect(document.querySelector('[role="dialog"]')).not.toBeNull()
            expect(domain.value).toBe('uncovered.example.net')
            expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
            expect(source.domains).toEqual(enabledHost.domains)
            expect(source.certificateId).toBe(assignableCertificate.id)
        },
    )

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
        const fetches = [0, 0]
        const subscriptions = [
            proxyHostManagementQueryKeys.all,
            proxyHostManagementQueryKeys.runtimeStatus,
        ].map((queryKey, index) =>
            new QueryObserver(activeQueryClient!, {
                queryKey,
                initialData: 0,
                staleTime: Infinity,
                queryFn: async () => ++fetches[index]!,
            }).subscribe(() => undefined),
        )
        const invalidate = spyOn(activeQueryClient!, 'invalidateQueries')
        expect(getButton('Save changes').disabled).toBeFalse()

        await click(getButton('Save changes'))

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
        })
        expect(invalidate).not.toHaveBeenCalledWith({
            queryKey: proxyHostManagementQueryKeys.runtimeStatus,
        })
        await waitForToast('success', 'Proxy host created successfully.')
        expect(document.querySelector('.rentnerproxy-toast-success')?.textContent).toContain(
            'Proxy host created successfully.',
        )
        expect(fetches).toEqual([1, 1])
        subscriptions.forEach((unsubscribe) => unsubscribe())
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
        await click(getButton('Save changes'))
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
        await click(getButton('Save changes'))
        await waitFor(
            () =>
                document.body.textContent?.includes('This domain is listed more than once.') ??
                false,
        )
        expect(createProxyHostHandlerMock).not.toHaveBeenCalled()

        await setControlValue(duplicateDomain, 'other.example.com')
        await blurControl(duplicateDomain)
        await click(getButton('Save changes'))
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
        await click(getButton('Save changes'))
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
        await click(getButton('Save changes'))
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
    test.each(['Delete', 'Disable', 'Enable'] as const)(
        'refetches active host root, page and runtime queries once after %s',
        async (action) => {
            await renderPage(allManagementPermissions)
            await waitFor(() => getRows().length === 2)
            let rootFetches = 0
            const observer = new QueryObserver(activeQueryClient!, {
                queryKey: proxyHostManagementQueryKeys.all,
                initialData: 0,
                staleTime: Infinity,
                queryFn: async () => ++rootFetches,
            })
            const unsubscribe = observer.subscribe(() => undefined)
            const pageFetches = loadProxyHostPageFixture.mock.calls.length
            const runtimeFetches = getProxyRuntimeStatusHandlerMock.mock.calls.length
            try {
                await openMenu(
                    getButton(
                        `Open actions for ${action === 'Enable' ? 'disabled.example.com' : 'app.example.com'}`,
                    ),
                )
                await click(getMenuItem(action))
                if (action !== 'Enable') await click(getButton(`${action} proxy host`))
                await waitForToast('success')
                expect(rootFetches).toBe(1)
                expect(loadProxyHostPageFixture).toHaveBeenCalledTimes(pageFetches + 1)
                expect(getProxyRuntimeStatusHandlerMock).toHaveBeenCalledTimes(runtimeFetches + 1)
            } finally {
                unsubscribe()
            }
        },
    )

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
            expect(document.querySelector('.rentnerproxy-toast-success')).toBeNull()
        },
    )
})

for (const canConfigureCompression of [true, false]) {
    test(`host creation compression respects apply permission: ${canConfigureCompression}`, async () => {
        await render(
            withQueryClient(
                <FormHarness mode="create" canConfigureCompression={canConfigureCompression} />,
            ),
        )
        const control = getButton('Response compression')
        expect(control.disabled).toBe(!canConfigureCompression)
        if (canConfigureCompression)
            await chooseSelectOption('Response compression', 'Automatic (Zstd/Gzip)')
        const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
        await setControlValue(domain, 'compression.example.com')
        await blurControl(domain)
        const upstream = document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!
        await setControlValue(upstream, 'backend.internal')
        await blurControl(upstream)
        await click(getButton('Save changes'))
        await waitFor(() => createProxyHostHandlerMock.mock.calls.length === 1)
        const submitted = createProxyHostHandlerMock.mock.calls[0]?.[0] as {
            data: { responseCompression?: string }
        }
        if (canConfigureCompression) expect(submitted.data.responseCompression).toBe('auto')
        else expect(submitted.data).not.toHaveProperty('responseCompression')
    })
}

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
    await click(getButton('Save changes'))
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

test('creates a proxy host and queues a certificate job with read-only host domains', async () => {
    getAssignableCertificatesHandlerMock.mockResolvedValueOnce([])
    const queuedJob = {
        success: true as const,
        message: 'admin.proxyHosts.certificateJob.messages.queued',
        job: certificateJobFixture(),
    }
    createProxyHostWithCertificateHandlerMock.mockRejectedValueOnce(new Error('lost response'))
    createProxyHostWithCertificateHandlerMock.mockResolvedValueOnce(queuedJob)
    await render(
        withQueryClient(
            <>
                <CertificateJobProgressObserver permissions={certificateProgressPermissions} />
                <FormHarness mode="create" canAssignCertificates canRequestCertificate />
            </>,
        ),
    )
    await setControlValue(
        document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!,
        'app.example.com',
    )
    await blurControl(document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!)
    await chooseSelectOption('TLS certificate', 'Request with ACME')
    await waitFor(() => document.querySelector('#certificate-request-domain-0') !== null)
    expect(
        document.querySelector<HTMLInputElement>('#certificate-request-domain-0')?.readOnly,
    ).toBe(true)
    expect(document.querySelector<HTMLInputElement>('#certificate-request-name')?.value).toBe(
        'app.example.com',
    )
    await setControlValue(
        document.querySelector<HTMLInputElement>('#certificate-request-name')!,
        'App TLS',
    )
    expect(document.querySelector('#certificate-request-terms')).toBeNull()
    expect(getButton('Request certificate and save').getAttribute('aria-describedby')).toBeTruthy()
    await setControlValue(
        document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!,
        'backend.internal',
    )
    await blurControl(document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!)
    const forceHttps = document.querySelector<HTMLInputElement>('input[id$="forceHttps"]')!
    expect(forceHttps.disabled).toBe(false)
    await click(forceHttps)
    await click(document.querySelector('[role="dialog"] button[type="submit"]')!)
    await waitFor(() => createProxyHostWithCertificateHandlerMock.mock.calls.length === 1)
    let finishRefresh: (() => void) | undefined
    const refresh = new Promise<void>((resolve) => {
        finishRefresh = resolve
    })
    const invalidate = spyOn(activeQueryClient!, 'invalidateQueries').mockImplementation(
        () => refresh,
    )
    await click(document.querySelector('[role="dialog"] button[type="submit"]')!)
    await waitFor(() => createProxyHostWithCertificateHandlerMock.mock.calls.length === 2)
    const firstCall = createProxyHostWithCertificateHandlerMock.mock.calls[0]![0] as unknown as {
        data: {
            idempotencyKey: string
            host: { domains: string[]; forceHttps: boolean }
            request: Record<string, unknown>
        }
    }
    const secondCall = createProxyHostWithCertificateHandlerMock.mock.calls[1]![0] as unknown as {
        data: {
            idempotencyKey: string
            host: { domains: string[]; forceHttps: boolean }
            request: Record<string, unknown>
        }
    }
    expect(firstCall.data.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u)
    expect(secondCall.data.idempotencyKey).toBe(firstCall.data.idempotencyKey)
    expect(firstCall.data.host.domains).toEqual(['app.example.com'])
    expect(firstCall.data.host.forceHttps).toBe(true)
    expect(firstCall.data.request).toMatchObject({
        name: 'App TLS',
        environment: 'production',
        challengeType: 'http-01',
        acceptTerms: true,
    })
    expect(secondCall.data.request).toMatchObject({
        environment: 'production',
    })
    expect(firstCall.data.request).not.toHaveProperty('domains')
    await waitFor(() => document.querySelector('[role="dialog"]') === null)
    await waitFor(() => getTaskToasts().length === 1)
    expect(getTaskToasts()[0]?.textContent).toContain('Certificate request')
    expect(getTaskToasts()[0]?.textContent).toContain('app.example.com')
    expect(getTaskToasts()[0]?.textContent).toContain('Queued')
    expect(document.body.textContent).not.toContain('Certificate request queued.')
    expect(
        activeQueryClient!.getQueryData<CertificateJobSummary[]>(
            certificateJobProgressQueryKeys.all,
        ),
    ).toEqual([queuedJob.job])
    expect(invalidate).toHaveBeenCalled()
    await act(async () => {
        finishRefresh?.()
        await refresh
    })
    invalidate.mockRestore()
})

test('closes an edited host form while its certificate job continues globally', async () => {
    const queuedJob = certificateJobFixture({
        id: '0198f2f0-0000-7000-8000-000000000085',
        domains: enabledHost.domains,
    })
    updateProxyHostWithCertificateHandlerMock.mockImplementationOnce(async () => {
        getCertificateJobProgressHandlerMock.mockResolvedValue([queuedJob])
        return {
            success: true,
            message: 'admin.proxyHosts.certificateJob.messages.queued',
            job: queuedJob,
        }
    })
    await render(
        withQueryClient(
            <>
                <CertificateJobProgressObserver permissions={certificateProgressPermissions} />
                <FormHarness
                    mode="edit"
                    proxyHost={enabledHost}
                    canAssignCertificates
                    canRequestCertificate
                />
            </>,
        ),
    )
    await waitFor(
        () =>
            document.querySelector<HTMLButtonElement>('button[aria-label="TLS certificate"]')
                ?.disabled === false,
    )
    await chooseSelectOption('TLS certificate', 'Request with ACME')
    await waitFor(() => document.querySelector('#certificate-request-name') !== null)
    expect(document.querySelector('#certificate-request-terms')).toBeNull()
    await click(document.querySelector('[role="dialog"] button[type="submit"]')!)

    await waitFor(() => updateProxyHostWithCertificateHandlerMock.mock.calls.length === 1)
    await waitFor(() => document.querySelector('[role="dialog"]') === null)
    await waitFor(() => getTaskToasts().length === 1)
    expect(getTaskToasts()[0]?.textContent).toContain('app.example.com')
    expect(getTaskToasts()[0]?.textContent).toContain('Queued')
    expect(
        activeQueryClient!.getQueryData<CertificateJobSummary[]>(
            certificateJobProgressQueryKeys.all,
        ),
    ).toEqual([queuedJob])
})

test('shows a safe assignable certificate load failure and offers retry', async () => {
    getAssignableCertificatesHandlerMock.mockRejectedValueOnce(
        new Error('private certificate query details'),
    )
    await render(withQueryClient(<FormHarness mode="create" canAssignCertificates />))
    await waitFor(() => document.querySelector('[role="alert"]') !== null)
    expect(document.body.textContent).toContain(
        'The requested data is temporarily unavailable. Try again.',
    )
    expect(document.body.textContent).not.toContain('private certificate query details')
    await click(getButton('Try again'))
    await waitFor(() => getAssignableCertificatesHandlerMock.mock.calls.length === 2)
})

describe('Caddy global proxy configuration editor', () => {
    const editablePermissions = [
        PERMISSIONS.PROXY_HOSTS_VIEW,
        PERMISSIONS.PROXY_HOSTS_UPDATE,
        PERMISSIONS.PROXY_HOSTS_APPLY,
    ] as const

    async function openEditor(): Promise<void> {
        await renderPage(editablePermissions)
        await waitFor(() => getRows().length === 2)
        await click(getButton('Caddy config'))
        await waitFor(() => document.querySelectorAll('input[type="number"]').length === 6)
    }

    test('saves the global automatic compression default', async () => {
        await openEditor()
        await chooseSelectOption('Response compression', 'Automatic (Zstd/Gzip)')
        await click(getButton('Save changes'))
        await waitFor(() => saveProxyConfigEditorHandlerMock.mock.calls.length === 1)
        expect(saveProxyConfigEditorHandlerMock.mock.calls[0]).toEqual([
            {
                data: {
                    baseRevision: editorBaseRevision,
                    settings: { proxyReadTimeoutSeconds: 90, responseCompression: 'auto' },
                },
            },
        ])
    })

    test('shows only settings and active config with formatted syntax colors', async () => {
        await openEditor()
        expect(document.body.textContent).not.toContain('Generated defaults')
        expect(document.body.textContent).not.toContain('Preview')
        expect(document.body.textContent).not.toContain('Reload')

        await click(getButton('Active config'))
        const codeBlock = document.querySelector('pre[aria-label="Active config"]')
        expect(codeBlock).not.toBeNull()
        expect(codeBlock?.textContent).toContain('\n  "http"')
        expect(codeBlock?.querySelector('[data-token="key"]')).not.toBeNull()
        expect(codeBlock?.querySelector('[data-token="number"]')).not.toBeNull()
    })

    for (const failure of ['response', 'transport'] as const) {
        test(`shows global save ${failure} failures only in a toast and preserves the draft for retry`, async () => {
            if (failure === 'response') {
                saveProxyConfigEditorHandlerMock.mockResolvedValueOnce({
                    success: false,
                    message: 'admin.proxyHosts.config.errors.saveFailed',
                })
            } else {
                saveProxyConfigEditorHandlerMock.mockRejectedValueOnce(new Error('unavailable'))
            }
            await openEditor()
            const fields = [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')]
            await setControlValue(fields[2]!, '120')
            await click(getButton('Save changes'))
            await waitForToast('error', 'The HTTP settings could not be saved.')
            expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
                'The HTTP settings could not be saved.',
            )
            expect(fields[2]?.value).toBe('120')
            await click(getButton('Save changes'))
            await waitFor(() => saveProxyConfigEditorHandlerMock.mock.calls.length === 2)
            await waitForToast('success')
        })
    }

    test('requires confirmation before restoring global defaults and supports cancel', async () => {
        await openEditor()
        await click(getButton('Restore defaults'))
        await waitFor(
            () => document.body.textContent?.includes('Restore generated defaults?') ?? false,
        )
        expect(resetProxyConfigEditorHandlerMock).not.toHaveBeenCalled()
        await click(getLastButton('Cancel'))
        await waitFor(() => !document.body.textContent?.includes('Restore generated defaults?'))
        expect(resetProxyConfigEditorHandlerMock).not.toHaveBeenCalled()
        await click(getButton('Restore defaults'))
        await click(getButton('Restore and apply'))
        await waitFor(() => resetProxyConfigEditorHandlerMock.mock.calls.length === 1)
        await waitForToast('success')
    })
})

describe('Caddy proxy host configuration editor', () => {
    const editablePermissions = [
        PERMISSIONS.PROXY_HOSTS_VIEW,
        PERMISSIONS.PROXY_HOSTS_UPDATE,
        PERMISSIONS.PROXY_HOSTS_APPLY,
    ] as const

    async function openHostConfig(
        permissions: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][] = editablePermissions,
        name = 'app.example.com',
    ): Promise<HTMLElement> {
        await renderPage(permissions)
        await waitFor(() => getRows().length === 2)
        await openMenu(getButton(`Open actions for ${name}`))
        await click(getMenuItem('Config'))
        await waitFor(() => document.querySelector('input[type="number"]') !== null)
        return document.querySelector('[role="dialog"]')!
    }

    test('enables browser-cache rules without losing the configuration dialog', async () => {
        const dialog = await openHostConfig()
        const toggle = getCheckbox('Enable browser-cache rules', dialog)
        expect(toggle.disabled).toBeFalse()
        await click(toggle)
        expect(toggle.checked).toBeTrue()
        expect(dialog.textContent).toContain('Browser cache for public assets')
        expect(dialog.querySelector('input[placeholder="/assets/app.a1b2.js"]')).not.toBeNull()
        expect(getButton('Save changes').disabled).toBeTrue()
        expect(getButton('Restore defaults').disabled).toBeFalse()
        await click(getButton('Save changes'))
        expect(saveProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
    })

    test('saves browser-cache paths, freshness and immutable alongside other host settings', async () => {
        const dialog = await openHostConfig()
        await click(getCheckbox('Enable browser-cache rules', dialog))
        const path = dialog.querySelector<HTMLInputElement>(
            'input[placeholder="/assets/app.a1b2.js"]',
        )!
        await setControlValue(path, '/static/')
        await setControlValue(dialog.querySelector<HTMLInputElement>('input[id*="-age-"]')!, '7200')
        await click(getCheckbox('This asset is versioned (immutable)', dialog))
        expect(getButton('Save changes').disabled).toBeFalse()
        expect(dialog.querySelector('[role="alert"]')).toBeNull()
        await click(getButton('Save changes'))
        await waitFor(() => saveProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(saveProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: {
                proxyHostId: editorFixture.proxyHostId,
                baseRevision: editorBaseRevision,
                settings: {
                    ...editorFixture.settings,
                    browserCache: {
                        enabled: true,
                        rules: [{ path: '/static/', maxAgeSeconds: 7200, immutable: true }],
                    },
                },
            },
        })
    })

    test('refreshes browser-cache settings before reopening the host form', async () => {
        const dialog = await openHostConfig()
        await click(getCheckbox('Enable browser-cache rules', dialog))
        await setControlValue(
            dialog.querySelector<HTMLInputElement>('input[placeholder="/assets/app.a1b2.js"]')!,
            '/static/',
        )
        const browserCache = {
            enabled: true,
            rules: [{ path: '/static/', maxAgeSeconds: 3600, immutable: false }],
        }
        loadProxyHostPageFixture.mockResolvedValue([{ ...enabledHost, browserCache }, disabledHost])
        await click(getButton('Save changes'))
        await waitFor(() => !dialog.isConnected)
        await openMenu(getButton('Open actions for app.example.com'))
        await click(getMenuItem('Edit'))
        await waitFor(() => document.querySelector('input[name="forwardHost"]') !== null)
        expect(getCheckbox('Enable browser-cache rules').checked).toBeTrue()
        expect(
            document.querySelector<HTMLInputElement>('input[placeholder="/assets/app.a1b2.js"]')
                ?.value,
        ).toBe('/static/')
    })

    test.each(['', '0', '1.5', '31536001'])(
        'blocks invalid browser-cache freshness %j and permits correcting it',
        async (invalidAge) => {
            getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
                ...editorFixture,
                settings: {
                    browserCache: {
                        enabled: true,
                        rules: [{ path: '/assets/', maxAgeSeconds: 60, immutable: false }],
                    },
                },
            })
            const dialog = await openHostConfig()
            const age = dialog.querySelector<HTMLInputElement>('input[id*="-age-"]')!
            await setControlValue(age, invalidAge)
            expect(age.value).toBe(invalidAge)
            expect(age.getAttribute('aria-invalid')).toBe('true')
            expect(
                document
                    .getElementById(age.getAttribute('aria-describedby')!)
                    ?.getAttribute('role'),
            ).toBe('alert')
            expect(getButton('Save changes').disabled).toBeTrue()
            await click(getButton('Save changes'))
            expect(saveProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
            await setControlValue(age, '31536000')
            expect(age.getAttribute('aria-invalid')).not.toBe('true')
            expect(dialog.querySelector('[role="alert"]')).toBeNull()
            expect(getButton('Save changes').disabled).toBeFalse()
        },
    )

    test('allows disabling an unfinished browser-cache draft and saves the explicit off setting', async () => {
        const dialog = await openHostConfig()
        const toggle = getCheckbox('Enable browser-cache rules', dialog)
        await click(toggle)
        const path = dialog.querySelector<HTMLInputElement>(
            'input[placeholder="/assets/app.a1b2.js"]',
        )!
        await setControlValue(path, '/api/')
        expect(getButton('Save changes').disabled).toBeTrue()
        await click(toggle)
        expect(dialog.querySelector('[role="alert"]')).toBeNull()
        expect(dialog.querySelector('input[placeholder="/assets/app.a1b2.js"]')).toBeNull()
        expect(getButton('Save changes').disabled).toBeFalse()
        await click(getButton('Save changes'))
        await waitFor(() => saveProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(saveProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: {
                proxyHostId: editorFixture.proxyHostId,
                baseRevision: editorBaseRevision,
                settings: {
                    ...editorFixture.settings,
                    browserCache: { enabled: false, rules: [] },
                },
            },
        })
    })

    for (const failure of ['response', 'transport'] as const) {
        test(`shows host save ${failure} failures only in a toast`, async () => {
            if (failure === 'response') {
                saveProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
                    success: false,
                    message: 'admin.proxyHosts.config.errors.saveFailed',
                })
            } else {
                saveProxyHostConfigEditorHandlerMock.mockRejectedValueOnce(
                    new Error('private transport failure'),
                )
            }
            const dialog = await openHostConfig()
            await click(getButton('Save changes'))
            await waitForToast('error', 'The HTTP settings could not be saved.')
            expect(dialog.textContent).not.toContain('The HTTP settings could not be saved.')
            expect(dialog.textContent).not.toContain('private transport failure')
        })
    }

    test('saves an upstream-only override and removes it when inheriting again', async () => {
        getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            ...editorFixture,
            settings: { responseCompression: 'off' },
            inheritedSettings: { responseCompression: 'auto' },
        })
        const dialog = await openHostConfig()
        expect(
            dialog
                .querySelector('[data-setting="responseCompression"]')
                ?.getAttribute('data-setting-source'),
        ).toBe('override')
        await chooseSelectOption('Response compression', 'Inherit global default')
        expect(dialog.textContent).toContain('Global setting: Automatic (Zstd/Gzip).')
        await click(getButton('Save changes'))
        await waitFor(() => saveProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(saveProxyHostConfigEditorHandlerMock.mock.calls[0]).toEqual([
            {
                data: {
                    proxyHostId: editorFixture.proxyHostId,
                    baseRevision: editorBaseRevision,
                    settings: {},
                },
            },
        ])
    })

    test('labels inherited and overridden values and updates the effective value', async () => {
        const dialog = await openHostConfig()
        const inherited = dialog.querySelector(
            '[data-setting="clientMaxBodySizeBytes"]',
        ) as HTMLElement
        const overridden = dialog.querySelector(
            '[data-setting="proxyReadTimeoutSeconds"]',
        ) as HTMLElement
        const caddyDefault = dialog.querySelector(
            '[data-setting="proxySendTimeoutSeconds"]',
        ) as HTMLElement

        expect(inherited.dataset.settingSource).toBe('inherited')
        expect(inherited.textContent).toContain('Inherited')
        expect(inherited.textContent).toContain('Effective: 1048576 bytes')
        expect(overridden.dataset.settingSource).toBe('override')
        expect(overridden.textContent).toContain('Override')
        expect(overridden.textContent).toContain('Effective: 90 seconds')
        expect(caddyDefault.textContent).toContain('Effective: Caddy default')

        const readTimeout = overridden.querySelector('input')!
        expect(readTimeout.getAttribute('aria-describedby')).toBe(
            'proxy-host-setting-proxyReadTimeoutSeconds-effective',
        )
        await setControlValue(readTimeout, '')
        await waitFor(() => overridden.dataset.settingSource === 'inherited')
        expect(overridden.textContent).toContain('Effective: 60 seconds')
    })

    test('renders numeric structured settings and read-only active config', async () => {
        getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            ...editorFixture,
            settings: { proxyReadTimeoutSeconds: 90 },
            active: { config: 'active-caddy-config', revision: editorBaseRevision },
        })
        const dialog = await openHostConfig()
        const input = dialog.querySelector<HTMLInputElement>('input[type="number"]')!
        expect(input.value).toBe('')
        expect(document.querySelector('#proxy-settings-source')).toBeNull()
        await click(getButton('Active config'))
        expect(dialog.textContent).toContain('active-caddy-config')
        expect(dialog.querySelector('textarea')).toBeNull()
    })

    test('shows relevant host routing, HTTPS, TLS, and current configuration status', async () => {
        const secureHost: ProxyHostSummary = {
            ...enabledHost,
            domains: [
                'very-long-service-name-for-responsive-layout.example.com',
                'service.example.com',
            ],
            certificateId: assignableCertificate.id,
            forceHttps: true,
            forwardScheme: 'https',
            forwardHost: '2001:db8::10',
            forwardPort: 443,
            upstreamTlsServerName: 'backend-with-a-long-name.internal.example',
            trustedCaId: assignableTrustedCa.id,
        }
        loadProxyHostPageFixture.mockResolvedValueOnce([secureHost, disabledHost])

        const dialog = await openHostConfig(editablePermissions, secureHost.domains[0]!)
        expect(dialog.textContent).toContain(secureHost.domains[0]!)
        expect(dialog.textContent).toContain('https://[2001:db8::10]:443')
        expect(dialog.textContent).toContain('HTTPS · HTTP redirects enabled')
        expect(dialog.textContent).toContain('HTTPS · verified with custom CA')
        expect(dialog.textContent).toContain('backend-with-a-long-name.internal.example')
        expect(dialog.querySelector('[data-config-state="active"]')?.textContent).toContain(
            'Active config loaded',
        )
        expect(dialog.textContent).not.toContain(assignableCertificate.id)
        expect(dialog.textContent).not.toContain(assignableTrustedCa.id)
    })

    test('keeps the host config readable but not editable for viewers', async () => {
        const dialog = await openHostConfig([PERMISSIONS.PROXY_HOSTS_VIEW])
        expect(dialog.textContent).toContain(
            'You can view the configuration. Editing requires both update and apply permissions.',
        )
        expect(
            [...dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')].every(
                (input) => input.disabled,
            ),
        ).toBeTrue()
        expect(
            [...dialog.querySelectorAll('button')].some((button) =>
                button.textContent?.includes('Save changes'),
            ),
        ).toBeFalse()
        expect(dialog.textContent).not.toContain('Restore defaults')
        await click(getButton('Active config'))
        expect(dialog.querySelector('pre[aria-label="Active config"]')).not.toBeNull()
    })

    test('explains an unavailable active config without offering reload', async () => {
        getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            ...editorFixture,
            active: null,
        })
        const dialog = await openHostConfig()
        expect(dialog.querySelector('[data-config-state="unavailable"]')?.textContent).toContain(
            'Active config unavailable',
        )
        await click(getButton('Active config'))
        expect(dialog.textContent).toContain('No active configuration is available for this host.')
        expect(dialog.textContent?.toLowerCase()).not.toContain('reload')
    })

    test('submits structured settings and has no advanced editor', async () => {
        getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            ...editorFixture,
            settings: {},
        })
        const dialog = await openHostConfig()
        const fields = [...dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')]
        await setControlValue(fields[2]!, '120')
        await click(getButton('Save changes'))
        await waitFor(() => saveProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(saveProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: {
                proxyHostId: enabledHost.id,
                baseRevision: editorBaseRevision,
                settings: { proxyReadTimeoutSeconds: 120 },
            },
        })
        expect(document.body.textContent).not.toContain('Advanced')
        expect(document.body.textContent).not.toContain('Nginx')
    })

    test('uses the shared formatted syntax block and removes preview-only host actions', async () => {
        const dialog = await openHostConfig()
        expect(dialog.querySelectorAll('input[type="number"]')).toHaveLength(4)
        expect(dialog.textContent).not.toContain('Preview')
        expect(dialog.textContent).not.toContain('Generated defaults')
        expect(dialog.textContent).not.toContain('Reload')
        expect(dialog.textContent).not.toContain('Response deadline')
        expect(dialog.textContent).not.toContain('Connection idle timeout')

        await click(getButton('Active config'))
        const codeBlock = dialog.querySelector('pre[aria-label="Active config"]')
        expect(codeBlock).not.toBeNull()
        expect(codeBlock?.textContent).toContain('\n  "http"')
        expect(codeBlock?.querySelector('[data-token="key"]')).not.toBeNull()
        expect(codeBlock?.querySelector('[data-token="number"]')).not.toBeNull()
    })

    test('reports pending saves and preserves conflicts for retry', async () => {
        saveProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            success: false,
            message: 'admin.proxyHosts.config.errors.configuration_conflict',
        })
        const dialog = await openHostConfig()
        const readTimeout = dialog.querySelector<HTMLInputElement>(
            '#proxy-host-setting-proxyReadTimeoutSeconds',
        )!
        await setControlValue(readTimeout, '120')
        await click(getButton('Save changes'))
        await waitForToast(
            'error',
            'The saved configuration changed. Your draft is kept. Review the current settings before saving.',
        )
        expect(readTimeout.value).toBe('120')
        expect(dialog.isConnected).toBeTrue()

        expect(getButton('Save changes').disabled).toBeTrue()
        expect(getProxyHostConfigEditorHandlerMock).toHaveBeenCalledTimes(1)
        getProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            ...editorFixture,
            baseRevision: 'sha256:' + '2'.repeat(64),
        })
        await click(getButton('Review latest configuration'))
        await waitFor(
            () =>
                document.body.textContent?.includes('Keep my draft and use this revision') ?? false,
        )
        await click(getButton('Keep my draft and use this revision'))
        expect(saveProxyHostConfigEditorHandlerMock).toHaveBeenCalledTimes(1)
        saveProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            success: true,
            message: 'admin.proxyHosts.runtime.savedPending',
            runtimeStatus: 'pending',
        })
        await click(getButton('Save changes'))
        await waitForToast('warning', 'Saved changes are waiting to be applied.')
        await waitFor(() => !dialog.isConnected)
    })

    test('confirms host reset, preserves host identity, and reports success', async () => {
        await openHostConfig()

        await click(getButton('Restore defaults'))
        await waitFor(
            () => document.body.textContent?.includes('Restore this host’s defaults?') ?? false,
        )
        expect(resetProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()
        await click(getLastButton('Cancel'))
        await waitFor(() => !document.body.textContent?.includes('Restore this host’s defaults?'))
        expect(resetProxyHostConfigEditorHandlerMock).not.toHaveBeenCalled()

        await click(getButton('Restore defaults'))
        await click(getButton('Restore and apply'))
        await waitFor(() => resetProxyHostConfigEditorHandlerMock.mock.calls.length === 1)
        expect(resetProxyHostConfigEditorHandlerMock).toHaveBeenCalledWith({
            data: {
                proxyHostId: enabledHost.id,
                baseRevision: editorBaseRevision,
            },
        })
        await waitForToast('success')
    })
})

describe.each(['host', 'global'] as const)('%s configuration conflict recovery', (scope) => {
    const latestRevision = 'sha256:' + '2'.repeat(64)
    const conflict = {
        success: false as const,
        message: 'admin.proxyHosts.config.errors.configuration_conflict',
    }
    const saveMock =
        scope === 'host' ? saveProxyHostConfigEditorHandlerMock : saveProxyConfigEditorHandlerMock
    const resetMock =
        scope === 'host' ? resetProxyHostConfigEditorHandlerMock : resetProxyConfigEditorHandlerMock
    const getMock =
        scope === 'host' ? getProxyHostConfigEditorHandlerMock : getProxyConfigEditorHandlerMock
    async function openEditor() {
        await renderPage([
            PERMISSIONS.PROXY_HOSTS_VIEW,
            PERMISSIONS.PROXY_HOSTS_UPDATE,
            PERMISSIONS.PROXY_HOSTS_APPLY,
        ])
        await waitFor(() => getRows().length === 2)
        if (scope === 'host') {
            await openMenu(getButton('Open actions for app.example.com'))
            await click(getMenuItem('Config'))
        } else await click(getButton('Caddy config'))
        await waitFor(() => document.querySelector('input[type="number"]') !== null)
        return document.querySelector('[role="dialog"]')!
    }
    function latest(settings: ProxyHttpSettings) {
        if (scope === 'host')
            getProxyHostConfigEditorHandlerMock.mockResolvedValue({
                ...editorFixture,
                settings,
                baseRevision: latestRevision,
            })
        else
            getProxyConfigEditorHandlerMock.mockResolvedValue({
                ...globalEditorFixture,
                settings,
                baseRevision: latestRevision,
            })
    }
    async function startConflict(value = '120') {
        saveMock.mockResolvedValueOnce(conflict)
        const dialog = await openEditor()
        await setControlValue(
            dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]!,
            value,
        )
        await click(getButton('Save changes'))
        await waitFor(() => getButton('Save changes').disabled)
        await waitFor(() => dialog.textContent?.includes('Review latest configuration') ?? false)
        return dialog
    }
    async function review() {
        expect(getMock.mock.calls.length).toBeGreaterThan(0)
        await click(getButton('Review latest configuration'))
        await waitFor(
            () =>
                document.body.textContent?.includes('Keep my draft and use this revision') ?? false,
        )
    }
    test('merges a compression draft using the explicitly reviewed configuration revision', async () => {
        saveMock.mockResolvedValueOnce(conflict)
        const dialog = await openEditor()
        await chooseSelectOption('Response compression', 'Automatic (Zstd/Gzip)')
        await click(getButton('Save changes'))
        await waitFor(() => getButton('Save changes').disabled)
        latest({ proxyReadTimeoutSeconds: 90, proxySendTimeoutSeconds: 180 })
        await review()
        expect(dialog.querySelector('table')?.textContent).toContain('Automatic (Zstd/Gzip)')
        await click(getButton('Keep my draft and use this revision'))
        await click(getButton('Save changes'))
        await waitFor(() => saveMock.mock.calls.length === 2)
        const expected = {
            baseRevision: latestRevision,
            settings: {
                responseCompression: 'auto',
                proxyReadTimeoutSeconds: 90,
                proxySendTimeoutSeconds: 180,
            },
        }
        expect(saveMock.mock.calls[1]?.[0]).toEqual({
            data: scope === 'host' ? { proxyHostId: enabledHost.id, ...expected } : expected,
        })
    })
    test('requires explicit review and separate save, merges only local edits and rejects a second race', async () => {
        const dialog = await startConflict()
        expect(getMock).toHaveBeenCalledTimes(1)
        expect(resetMock).not.toHaveBeenCalled()
        latest({ proxyReadTimeoutSeconds: 90, proxySendTimeoutSeconds: 180 })
        await review()
        expect(dialog.querySelector('table')?.textContent).toContain('180 seconds')
        expect(dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]!.value).toBe(
            '120',
        )
        await click(getButton('Keep my draft and use this revision'))
        expect(saveMock).toHaveBeenCalledTimes(1)
        saveMock.mockResolvedValueOnce(conflict)
        await click(getButton('Save changes'))
        await waitFor(() => saveMock.mock.calls.length === 2)
        const expected = {
            baseRevision: latestRevision,
            settings: { proxyReadTimeoutSeconds: 120, proxySendTimeoutSeconds: 180 },
        }
        expect(saveMock.mock.calls[1]?.[0]).toEqual({
            data: scope === 'host' ? { proxyHostId: enabledHost.id, ...expected } : expected,
        })
        await waitFor(() => dialog.textContent?.includes('Review latest configuration') ?? false)
        expect(getButton('Save changes').disabled).toBeTrue()
        expect(dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]!.value).toBe(
            '120',
        )
    })
    test('requires confirmation for overlapping edits, preserves a cleared field and the reviewed revision', async () => {
        const dialog = await startConflict('')
        latest({ proxyReadTimeoutSeconds: 180, proxySendTimeoutSeconds: 200 })
        await review()
        await click(getButton('Keep my draft and use this revision'))
        await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 2)
        await click(getLastButton('Cancel'))
        expect(saveMock).toHaveBeenCalledTimes(1)
        expect(getButton('Save changes').disabled).toBeTrue()
        // A background update must not silently replace the values the user reviewed.
        await act(async () =>
            activeQueryClient?.setQueryData(
                scope === 'host'
                    ? proxyHostManagementQueryKeys.hostConfigEditor(enabledHost.id)
                    : proxyHostManagementQueryKeys.configEditor,
                {
                    ...(scope === 'host' ? editorFixture : globalEditorFixture),
                    baseRevision: 'sha256:' + '3'.repeat(64),
                    settings: { proxySendTimeoutSeconds: 300 },
                },
            ),
        )
        await click(getButton('Keep my draft and use this revision'))
        await click(getButton('Keep my edited values'))
        expect(saveMock).toHaveBeenCalledTimes(1)
        await click(getButton('Save changes'))
        await waitFor(() => saveMock.mock.calls.length === 2)
        const expected = {
            baseRevision: latestRevision,
            settings: { proxySendTimeoutSeconds: 200 },
        }
        expect(saveMock.mock.calls[1]?.[0]).toEqual({
            data: scope === 'host' ? { proxyHostId: enabledHost.id, ...expected } : expected,
        })
        expect(
            dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]?.value ?? '',
        ).toBe('')
    })
    test('keeps the draft when review fails and adopts saved settings only on explicit choice', async () => {
        const dialog = await startConflict()
        getMock.mockRejectedValueOnce(new Error('unavailable'))
        await click(getButton('Review latest configuration'))
        await waitForToast('error', 'The configuration could not be loaded.')
        expect(dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]!.value).toBe(
            '120',
        )
        expect(getButton('Save changes').disabled).toBeTrue()
        latest({ proxyReadTimeoutSeconds: 180 })
        await review()
        await click(getButton('Use current saved settings'))
        expect(dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]!.value).toBe(
            '180',
        )
        expect(saveMock).toHaveBeenCalledTimes(1)
        expect(getButton('Save changes').disabled).toBeFalse()
    })
    test.each([false, true])(
        'requires fresh reset confirmation after resolving a reset conflict (edited draft: %s)',
        async (edited) => {
            resetMock.mockResolvedValueOnce(conflict)
            const dialog = await openEditor()
            if (edited)
                await setControlValue(
                    dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')[3]!,
                    '120',
                )
            await click(getButton('Restore defaults'))
            await click(getButton('Restore and apply'))
            await waitFor(
                () => dialog.textContent?.includes('Review latest configuration') ?? false,
            )
            expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
            expect(getButton('Restore defaults').disabled).toBeTrue()
            latest({ proxyReadTimeoutSeconds: 180 })
            await review()
            await click(getButton('Keep my draft and use this revision'))
            expect(
                dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]!.value,
            ).toBe('180')
            expect(resetMock).toHaveBeenCalledTimes(1)
            expect(
                dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')[3]!.value,
            ).toBe(edited ? '120' : '')
            await click(getButton('Restore defaults'))
            expect(resetMock).toHaveBeenCalledTimes(1)
            await click(getButton('Restore and apply'))
            await waitFor(() => resetMock.mock.calls.length === 2)
            expect(resetMock.mock.calls[1]?.[0]).toEqual({
                data:
                    scope === 'host'
                        ? { proxyHostId: enabledHost.id, baseRevision: latestRevision }
                        : { baseRevision: latestRevision },
            })
        },
    )
})

describe('integrated proxy host setup guide', () => {
    test('moves focus to the new step heading after navigation without resetting the draft', async () => {
        await render(withQueryClient(<FormHarness mode="create" initialGuideOpen />))
        const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
        await setControlValue(domain, 'keyboard.example.com')
        await act(async () => getButton('Next step').focus())
        await click(getButton('Next step'))
        expect(document.activeElement?.tagName).toBe('H3')
        expect(document.activeElement?.textContent).toContain('2/3 · Destination service')
        await act(async () => getButton('Next step').focus())
        await click(getButton('Next step'))
        expect(getButton('Next step').disabled).toBe(true)
        expect(document.activeElement?.textContent).toContain('3/3 · Public HTTPS')
        await act(async () => getButton('Previous step').focus())
        await click(getButton('Previous step'))
        await act(async () => getButton('Previous step').focus())
        await click(getButton('Previous step'))
        expect(getButton('Previous step').disabled).toBe(true)
        expect(document.activeElement?.textContent).toContain('1/3 · Public domains')
        expect(document.querySelector('input[name="domains[0]"]')).toBe(domain)
        expect(domain.value).toBe('keyboard.example.com')
        expect(createProxyHostHandlerMock).not.toHaveBeenCalled()
    })

    test('reflects an imported certificate without triggering issuance', async () => {
        getAssignableCertificatesHandlerMock.mockResolvedValue([
            { ...assignableCertificate, source: 'manual' },
        ])
        await render(
            withQueryClient(
                <FormHarness
                    mode="edit"
                    proxyHost={{ ...enabledHost, certificateId: assignableCertificate.id }}
                    canAssignCertificates
                    initialGuideOpen
                />,
            ),
        )
        await click(getButton('Next step'))
        await click(getButton('Next step'))
        await waitFor(
            () =>
                document.body.textContent?.includes(
                    'Selected certificate: ' + assignableCertificate.name,
                ) ?? false,
        )
        expect(document.body.textContent).toContain('Source: Manual')
        expect(document.body.textContent).not.toContain('No public certificate selected')
        expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
        expect(createProxyHostWithCertificateHandlerMock).not.toHaveBeenCalled()
    })

    test.each(['applied', 'pending', 'failed'] as const)(
        'guided save preserves authoritative %s feedback',
        async (outcome) => {
            createProxyHostHandlerMock.mockResolvedValueOnce(
                outcome === 'failed'
                    ? {
                          success: false,
                          message: 'admin.proxyHosts.errors.saveFailed',
                      }
                    : {
                          success: true,
                          message: 'admin.proxyHosts.messages.created',
                          runtimeStatus: outcome,
                      },
            )
            await render(withQueryClient(<FormHarness mode="create" initialGuideOpen />))
            const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
            await setControlValue(domain, 'guided.example.com')
            await blurControl(domain)
            const upstream = document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!
            await setControlValue(upstream, 'backend.internal')
            await blurControl(upstream)
            await click(getButton('Next step'))
            await click(getButton('Next step'))
            await click(getButton('Save changes'))
            await waitForToast(
                outcome === 'failed' ? 'error' : outcome === 'pending' ? 'warning' : 'success',
            )
            if (outcome === 'failed') {
                expect(document.querySelector('[role="dialog"]')).not.toBeNull()
                expect(domain.value).toBe('guided.example.com')
                expect(document.body.textContent).toContain('Fix highlighted fields before saving')
            } else {
                await waitFor(() => document.querySelector('[role="dialog"]') === null)
            }
            if (outcome === 'pending') {
                expect(document.body.textContent).toContain(
                    'Saved changes are waiting to be applied.',
                )
                expect(document.querySelector('.rentnerproxy-toast-success')).toBeNull()
            }
        },
    )

    test('opens automatically for the first host and can be skipped and reopened', async () => {
        loadProxyHostPageFixture.mockResolvedValue([])
        await renderPage([PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_CREATE])
        await waitFor(() => !getButton('Add proxy host').disabled)
        await click(getButton('Add proxy host'))
        await waitFor(() => document.querySelector('[role="dialog"]') !== null)
        expect(getButton('Skip guide').getAttribute('aria-expanded')).toBe('true')
        await click(getButton('Skip guide'))
        expect(document.body.textContent).not.toContain('Public domains')
        await click(getButton('Show setup guide'))
        expect(document.body.textContent).toContain('Public domains')
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    })

    test('preserves the same form draft through steps, skip and reopen', async () => {
        await render(withQueryClient(<FormHarness mode="create" initialGuideOpen />))
        const domain = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
        const upstream = document.querySelector<HTMLInputElement>('input[name="forwardHost"]')!
        await setControlValue(domain, '*.example.com')
        await setControlValue(upstream, 'backend.internal')
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="forwardPort"]')!,
            '8080',
        )
        expect(document.body.textContent).toContain('Wildcard certificate requests require DNS-01')
        await click(getButton('Next step'))
        expect(document.body.textContent).toContain('http://backend.internal:8080')
        expect(document.querySelector('input[name="domains[0]"]')).toBe(domain)
        await click(getButton('Next step'))
        expect(document.body.textContent).toContain('No public certificate selected')
        expect(document.body.textContent).toContain('A queued or issuing certificate is not ready')
        await click(getButton('Skip guide'))
        await click(getButton('Show setup guide'))
        expect(document.body.textContent).toContain('Public HTTPS')
        await click(getButton('Previous step'))
        await click(getButton('Previous step'))
        expect(domain.value).toBe('*.example.com')
        expect(upstream.value).toBe('backend.internal')
        expect(createProxyHostHandlerMock).not.toHaveBeenCalled()
    })

    test('reflects the requested challenge and keeps certificate drafts when guidance is hidden', async () => {
        await render(
            withQueryClient(
                <FormHarness
                    mode="create"
                    canAssignCertificates
                    canRequestCertificate
                    initialGuideOpen
                />,
            ),
        )
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!,
            'app.example.com',
        )
        await chooseSelectOption('TLS certificate', 'Request with ACME')
        await setControlValue(
            document.querySelector<HTMLInputElement>('#certificate-request-name')!,
            'Draft TLS',
        )
        await click(getButton('Next step'))
        await click(getButton('Next step'))
        expect(document.body.textContent).toContain('HTTP-01 needs public DNS')
        await chooseSelectOption('ACME challenge', 'DNS-01 (DNS provider)')
        expect(document.body.textContent).toContain('DNS-01 needs the supported DNS provider')
        await click(getButton('Skip guide'))
        await click(getButton('Show setup guide'))
        expect(document.querySelector<HTMLInputElement>('#certificate-request-name')?.value).toBe(
            'Draft TLS',
        )
        expect(document.body.textContent).not.toContain('HTTP-01 needs public DNS')
        expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
    })

    test('guidance navigation cannot bypass validation or submit a host', async () => {
        await render(withQueryClient(<FormHarness mode="create" initialGuideOpen />))
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!,
            'https://invalid.example',
        )
        await click(getButton('Next step'))
        await click(getButton('Next step'))
        await act(async () => {
            document
                .querySelector('form')!
                .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        })
        expect(createProxyHostHandlerMock).not.toHaveBeenCalled()
        expect(
            document.querySelector('input[name="domains[0]"]')?.getAttribute('aria-invalid'),
        ).toBe('true')
        expect(document.body.textContent).toContain('Fix highlighted fields before saving')
    })
})

function BrowserCacheHarness({
    initialValue,
}: {
    initialValue?: ProxyHttpSettings['browserCache']
}) {
    const [value, setValue] = useState(initialValue)
    return <BrowserCacheFields value={value} onChange={setValue} disabled={false} />
}

describe('browser-cache rule controls', () => {
    test('keeps rule editing accessible and reports invalid or overlapping scopes', async () => {
        await render(<BrowserCacheHarness />)
        expect(getButton('Add rule').disabled).toBeTrue()
        await click(getCheckbox('Enable browser-cache rules'))
        expect(document.querySelector('[role="alert"]')?.textContent).toContain(
            'unique public asset paths',
        )
        const path = document.querySelector<HTMLInputElement>(
            'input[placeholder="/assets/app.a1b2.js"]',
        )!
        expect(document.querySelector('label[for="' + path.id + '"]')?.textContent).toBe(
            'Public file path or directory/',
        )
        await setControlValue(path, '/assets/')
        expect(document.querySelector('[role="alert"]')).toBeNull()
        await click(getButton('Add rule'))
        const inputs = document.querySelectorAll<HTMLInputElement>(
            'input[placeholder="/assets/app.a1b2.js"]',
        )
        await setControlValue(inputs[1]!, '/assets/app.123.js')
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('must not overlap')
        await click(getLastButton('Remove rule'))
        expect(document.querySelector('[role="alert"]')).toBeNull()
        expect(document.querySelector('input[placeholder="/assets/app.a1b2.js"]')).toBe(path)
    })
    test('renders and edits browser-cache rules without requiring randomUUID', async () => {
        const randomUUID = spyOn(crypto, 'randomUUID').mockImplementation(() => {
            throw new Error('randomUUID is unavailable over insecure HTTP')
        })
        try {
            await render(
                <BrowserCacheHarness
                    initialValue={{
                        enabled: true,
                        rules: [{ path: '/assets/', maxAgeSeconds: 60, immutable: false }],
                    }}
                />,
            )
            await click(getButton('Add rule'))
            expect(
                document.querySelectorAll('input[placeholder="/assets/app.a1b2.js"]'),
            ).toHaveLength(2)
            await click(getLastButton('Remove rule'))
            await click(getCheckbox('Enable browser-cache rules'))
            await click(getCheckbox('Enable browser-cache rules'))
            expect(
                document.querySelector<HTMLInputElement>('input[placeholder="/assets/app.a1b2.js"]')
                    ?.value,
            ).toBe('/assets/')
            expect(randomUUID).not.toHaveBeenCalled()
        } finally {
            randomUUID.mockRestore()
        }
    })
    test('preserves valid rules when disabling and re-enabling browser-cache rules', async () => {
        await render(
            <BrowserCacheHarness
                initialValue={{
                    enabled: true,
                    rules: [{ path: '/static/', maxAgeSeconds: 7200, immutable: true }],
                }}
            />,
        )
        const toggle = getCheckbox('Enable browser-cache rules')
        await click(getButton('Add rule'))
        await click(toggle)
        expect(document.querySelector('input[id*="-age-"]')).toBeNull()
        expect(getButton('Add rule').disabled).toBeTrue()
        await click(toggle)
        expect(document.querySelectorAll('input[placeholder="/assets/app.a1b2.js"]')).toHaveLength(
            1,
        )
        expect(
            document.querySelector<HTMLInputElement>('input[placeholder="/assets/app.a1b2.js"]')
                ?.value,
        ).toBe('/static/')
        expect(document.querySelector<HTMLInputElement>('input[id*="-age-"]')?.value).toBe('7200')
        expect(getCheckbox('This asset is versioned (immutable)').checked).toBeTrue()
    })
    test('bounds browser-cache rules and preserves remaining row state when removing a rule', async () => {
        await render(
            <BrowserCacheHarness
                initialValue={{
                    enabled: true,
                    rules: Array.from({ length: 20 }, (_, index) => ({
                        path: `/assets/app.${index}.js`,
                        maxAgeSeconds: 60,
                        immutable: false,
                    })),
                }}
            />,
        )
        const ages = document.querySelectorAll<HTMLInputElement>('input[id*="-age-"]')
        await setControlValue(ages[1]!, '')
        expect(getButton('Add rule').disabled).toBeTrue()
        await click(getButton('Remove rule'))
        expect(document.querySelectorAll('input[placeholder="/assets/app.a1b2.js"]')).toHaveLength(
            19,
        )
        expect(document.querySelector('input[id*="-age-"]')).toBe(ages[1]!)
        expect(ages[1]!.value).toBe('')
        expect(getButton('Add rule').disabled).toBeFalse()
    })
    test('disables controls for read-only settings', async () => {
        await render(
            <BrowserCacheFields
                value={{
                    enabled: true,
                    rules: [{ path: '/assets/', maxAgeSeconds: 60, immutable: true }],
                }}
                onChange={() => {
                    throw new Error('read-only settings changed')
                }}
                disabled
            />,
        )
        expect(document.querySelector('fieldset')?.disabled).toBe(true)
        expect(getButton('Add rule').disabled).toBe(true)
        expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(
            true,
        )
    })
})

describe('browser-cache host form integration', () => {
    test('enables and saves browser-cache rules from the host form', async () => {
        await render(
            withQueryClient(
                <FormHarness mode="edit" proxyHost={enabledHost} canConfigureBrowserCache />,
            ),
        )
        await click(getCheckbox('Enable browser-cache rules'))
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[placeholder="/assets/app.a1b2.js"]')!,
            '/assets/',
        )
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[id*="-age-"]')!,
            '1800',
        )
        await click(getCheckbox('This asset is versioned (immutable)'))
        await click(getButton('Save changes'))
        await waitFor(() => updateProxyHostHandlerMock.mock.calls.length === 1)
        expect(updateProxyHostHandlerMock.mock.calls[0]?.[0]).toMatchObject({
            data: {
                proxyHostId: enabledHost.id,
                browserCache: {
                    enabled: true,
                    rules: [{ path: '/assets/', maxAgeSeconds: 1800, immutable: true }],
                },
            },
        })
    })
    test.each(['disable', 'correct'] as const)(
        'recovers from invalid browser-cache rules by %s',
        async (recovery) => {
            await render(
                withQueryClient(
                    <FormHarness mode="edit" proxyHost={enabledHost} canConfigureBrowserCache />,
                ),
            )
            await click(getCheckbox('Enable browser-cache rules'))
            await click(getButton('Save changes'))
            expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
            expect(document.querySelector('[role="dialog"]')).not.toBeNull()
            expect(
                document.querySelector('input[placeholder="/assets/app.a1b2.js"]'),
            ).not.toBeNull()
            if (recovery === 'disable') await click(getCheckbox('Enable browser-cache rules'))
            else
                await setControlValue(
                    document.querySelector<HTMLInputElement>(
                        'input[placeholder="/assets/app.a1b2.js"]',
                    )!,
                    '/assets/',
                )
            await click(getButton('Save changes'))
            await waitFor(() => updateProxyHostHandlerMock.mock.calls.length === 1)
            expect(updateProxyHostHandlerMock.mock.calls[0]?.[0]).toMatchObject({
                data: {
                    browserCache:
                        recovery === 'disable'
                            ? { enabled: false, rules: [] }
                            : {
                                  enabled: true,
                                  rules: [
                                      { path: '/assets/', maxAgeSeconds: 3600, immutable: false },
                                  ],
                              },
                },
            })
        },
    )
    test('preserves browser-cache settings when editing without apply permission', async () => {
        await render(
            withQueryClient(
                <FormHarness
                    mode="edit"
                    proxyHost={{
                        ...enabledHost,
                        browserCache: {
                            enabled: true,
                            rules: [{ path: '/assets/', maxAgeSeconds: 60, immutable: true }],
                        },
                    }}
                />,
            ),
        )
        expect(getCheckbox('Enable browser-cache rules').disabled).toBeTrue()
        expect(document.querySelector<HTMLInputElement>('input[id*="-age-"]')?.disabled).toBeTrue()
        await click(getButton('Save changes'))
        await waitFor(() => updateProxyHostHandlerMock.mock.calls.length === 1)
        expect(updateProxyHostHandlerMock.mock.calls[0]?.[0]).not.toHaveProperty(
            'data.browserCache',
        )
    })
})

describe('public response cache form controls', () => {
    test('edits explicit rules and disables them without changing unrelated host fields', async () => {
        await render(
            withQueryClient(
                <FormHarness
                    mode="edit"
                    proxyHost={{
                        ...enabledHost,
                        responseCache: { pathPrefixes: ['/assets/'], ttlSeconds: 60 },
                    }}
                    canApplyResponseCache
                />,
            ),
        )
        const ttl = document.querySelector<HTMLInputElement>('input[id$="-response-cache-ttl"]')!
        expect(ttl.value).toBe('60')
        await setControlValue(ttl, '120')
        await click(getButton('Save changes'))
        await waitFor(() => updateProxyHostHandlerMock.mock.calls.length === 1)
        expect(updateProxyHostHandlerMock.mock.calls[0]?.[0]).toMatchObject({
            data: {
                responseCache: { pathPrefixes: ['/assets/'], ttlSeconds: 120 },
                proxyHostId: enabledHost.id,
            },
        })
    })
    test('turns an existing cache off explicitly', async () => {
        await render(
            withQueryClient(
                <FormHarness
                    mode="edit"
                    proxyHost={{
                        ...enabledHost,
                        responseCache: { pathPrefixes: ['/assets/'], ttlSeconds: 60 },
                    }}
                    canApplyResponseCache
                />,
            ),
        )
        await click(document.querySelector<HTMLInputElement>('input[id$="-response-cache"]')!)
        expect(document.querySelector('input[id$="-response-cache-ttl"]')).toBeNull()
        await click(getButton('Save changes'))
        await waitFor(() => updateProxyHostHandlerMock.mock.calls.length === 1)
        expect(updateProxyHostHandlerMock.mock.calls[0]?.[0]).toMatchObject({
            data: { responseCache: null },
        })
    })
    test('ordinary editors preserve the setting without an APPLY control or payload', async () => {
        await render(
            withQueryClient(
                <FormHarness
                    mode="edit"
                    proxyHost={{
                        ...enabledHost,
                        responseCache: { pathPrefixes: ['/assets/'], ttlSeconds: 60 },
                    }}
                />,
            ),
        )
        expect(document.querySelector('input[id$="-response-cache"]')).toBeNull()
        await click(getButton('Save changes'))
        await waitFor(() => updateProxyHostHandlerMock.mock.calls.length === 1)
        expect(updateProxyHostHandlerMock.mock.calls[0]?.[0]).not.toHaveProperty(
            'data.responseCache',
        )
    })
    test('rejects reserved API rules before submitting', async () => {
        await render(
            withQueryClient(
                <FormHarness
                    mode="edit"
                    proxyHost={{
                        ...enabledHost,
                        responseCache: { pathPrefixes: ['/assets/'], ttlSeconds: 60 },
                    }}
                    canApplyResponseCache
                />,
            ),
        )
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[id$="-response-cache-paths"]')!,
            '/api/',
        )
        await click(getButton('Save changes'))
        await waitFor(
            () => document.body.textContent?.includes('Use 1–16 unique path prefixes') ?? false,
        )
        expect(updateProxyHostHandlerMock).not.toHaveBeenCalled()
    })
})

test('manual DNS binding wait exposes a permission-gated link to its exact certificate details', async () => {
    const job = certificateJobFixture({ stage: 'issuing', controllerStage: 'awaiting_dns' })
    await renderCertificateProgress([job])
    await waitFor(() => document.querySelector('button[data-severity]') !== null)
    const alert = await openPageAlerts()
    const link = alert.querySelector<HTMLAnchorElement>('a')
    expect(link?.getAttribute('href')).toBe(
        '/certificates?selectedCertificateId=' + job.certificateId,
    )
    expect(link?.textContent).toContain('Open TXT records and validation')
    expect(getTaskToasts()[0]?.classList.contains('rentnerproxy-toast-info')).toBeTrue()
})

test('manual DNS binding wait asks for an operator when certificate view permission is absent', async () => {
    getCertificateJobProgressHandlerMock.mockResolvedValue([
        certificateJobFixture({ stage: 'issuing', controllerStage: 'awaiting_dns' }),
    ])
    await render(
        withQueryClient(
            <CertificateJobProgressObserver permissions={[PERMISSIONS.PROXY_HOSTS_VIEW]} />,
        ),
    )
    await waitFor(() => document.querySelector('button[data-severity]') !== null)
    const alert = await openPageAlerts()
    expect(alert.querySelector('a')).toBeNull()
    expect(alert.textContent).toContain(
        'A certificate operator must open these certificate details',
    )
})

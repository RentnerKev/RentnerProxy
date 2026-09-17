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
    ProxyConfigEditorData,
} from '../shared/Types/proxy-runtime.types'
import type {
    CertificateJobActionResult,
    CertificateJobSummary,
} from '../shared/Types/certificate-jobs.types'
import { proxyHostManagementQueryKeys } from '../features/Admin/ProxyHostManagement/queryKeys'
import { certificateJobProgressQueryKeys } from '../features/Admin/ProxyHostManagement/CertificateJobs/queryKeys'
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
const previewProxyConfigEditorHandlerMock = mock(async () => ({
    config: hostConfig(120),
    revision: editorBaseRevision,
}))
const saveProxyConfigEditorHandlerMock = mock(async (): Promise<ProxyHostActionResult> => ({
    success: true,
    message: 'admin.proxyHosts.config.saved',
    runtimeStatus: 'applied',
}))
const resetProxyConfigEditorHandlerMock = mock(async (): Promise<ProxyHostActionResult> => ({
    success: true,
    message: 'admin.proxyHosts.config.reset',
    runtimeStatus: 'applied',
}))

mock.module('../features/Admin/ProxyHostManagement/server', () => ({
    getProxyConfigEditorHandler: getProxyConfigEditorHandlerMock,
    previewProxyConfigEditorHandler: previewProxyConfigEditorHandlerMock,
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
    getProxyHostsHandler: getProxyHostsHandlerMock,
    applyProxyConfigurationHandler: applyProxyConfigurationHandlerMock,
    updateProxyHostHandler: updateProxyHostHandlerMock,
}))

const getAssignableCertificatesHandlerMock = mock(async (): Promise<CertificateSummary[]> => [])
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

mock.module('../features/Admin/ProxyHostManagement/CertificateJobs/server', () => ({
    createProxyHostWithCertificateHandler: createProxyHostWithCertificateHandlerMock,
    updateProxyHostWithCertificateHandler: updateProxyHostWithCertificateHandlerMock,
    requestProxyHostCertificateHandler: requestProxyHostCertificateHandlerMock,
    retryCertificateJobHandler: retryCertificateJobHandlerMock,
    getCertificateJobProgressHandler: getCertificateJobProgressHandlerMock,
}))

const { default: CertificateJobProgressObserver } =
    await import('../features/Admin/ProxyHostManagement/CertificateJobs/CertificateJobProgressObserver')

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
    window.sessionStorage.clear()
    getProxyConfigEditorHandlerMock.mockReset().mockResolvedValue(globalEditorFixture)
    previewProxyConfigEditorHandlerMock.mockReset().mockResolvedValue({
        config: hostConfig(120),
        revision: editorBaseRevision,
    })
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

const certificateProgressPermissions = [
    PERMISSIONS.PROXY_HOSTS_VIEW,
    PERMISSIONS.CERTIFICATES_VIEW,
    PERMISSIONS.CERTIFICATES_ISSUE,
] as const

function getTaskToasts(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[data-toast-kind="task"]')]
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
            .map((toast) => toast.textContent ?? '')
            .join('\n')
        expect(text).toContain('app.example.com')
        expect(text).toContain('Queued')
        expect(text).toContain('disabled.example.com')
        expect(text).toContain('Waiting for validation')
        expect(text).not.toMatch(/\d+%/u)
        for (const toast of getTaskToasts()) {
            expect(toast.querySelector('.animate-spin')).not.toBeNull()
            expect(toast.querySelector('[aria-label="Dismiss notification"]')).toBeNull()
            expect(toast.querySelector('[aria-hidden="true"][style]')).toBeNull()
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

        await waitFor(() => getTaskToasts()[0]?.dataset.toastTone === 'success')
        const toast = getTaskToasts()[0]!
        expect(toast.textContent).toContain('Certificate assigned successfully.')
        expect(toast.querySelector('.animate-spin')).toBeNull()
        expect(toast.querySelector('[aria-label="Dismiss notification"]')).not.toBeNull()
        const progress = toast.querySelector<HTMLElement>('[aria-hidden="true"][style]')
        expect(progress?.style.animationDuration).toBe('5000ms')
        await waitFor(() => getTaskToasts().length === 0, 6_000)
    }, 8_000)

    test('keeps failures actionable and retries the exact job', async () => {
        const failed = certificateJobFixture({
            stage: 'failed',
            controllerStage: 'failed',
            lastErrorCode: 'controller_unavailable',
        })
        const retried = certificateJobFixture({ updatedAt: new Date('2026-01-01T00:01:00Z') })
        retryCertificateJobHandlerMock.mockResolvedValue({
            success: true,
            message: 'admin.proxyHosts.certificateJob.messages.retried',
            job: retried,
        })
        await renderCertificateProgress([failed])
        await waitFor(() => getTaskToasts()[0]?.dataset.toastTone === 'error')
        const failedToast = getTaskToasts()[0]!
        expect(failedToast.textContent).toContain('The proxy controller is unavailable.')
        expect(failedToast.querySelector('[aria-hidden="true"][style]')).toBeNull()
        expect(failedToast.querySelector('[aria-label="Dismiss notification"]')).not.toBeNull()
        expect(failedToast.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe(
            '/certificates',
        )

        getCertificateJobProgressHandlerMock.mockResolvedValue([retried])
        await click(getButton('Retry'))
        await waitFor(() => retryCertificateJobHandlerMock.mock.calls.length === 1)
        expect(retryCertificateJobHandlerMock).toHaveBeenCalledWith({
            data: { jobId: failed.id },
        })
        await waitFor(() => getTaskToasts()[0]?.dataset.toastTone === 'info')
        expect(getTaskToasts()[0]?.textContent).toContain('Queued')
        expect(getTaskToasts()[0]?.querySelector('[aria-label="Dismiss notification"]')).toBeNull()
    })

    test('keeps an unchanged dismissed failure hidden after reload and shows new progress', async () => {
        const failed = certificateJobFixture({
            stage: 'failed',
            controllerStage: 'retry_scheduled',
            lastErrorCode: 'acme_failed',
        })
        await renderCertificateProgress([failed])
        await waitFor(() => getTaskToasts()[0]?.dataset.toastTone === 'error')
        await click(getButton('Dismiss notification'))
        await waitFor(() => getTaskToasts().length === 0)

        await act(async () => activeRoot?.unmount())
        activeRoot = null
        activeQueryClient?.clear()
        activeQueryClient = null
        document.body.replaceChildren()

        await renderCertificateProgress([failed])
        await waitFor(() => getCertificateJobProgressHandlerMock.mock.calls.length >= 2)
        expect(getTaskToasts()).toHaveLength(0)

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
        await waitFor(() => getTaskToasts()[0]?.dataset.toastTone === 'info')
        expect(getTaskToasts()[0]?.textContent).toContain('Queued')
    })

    test('updates failure actions when certificate permissions change', async () => {
        const failed = certificateJobFixture({
            stage: 'failed',
            controllerStage: 'failed',
            lastErrorCode: 'controller_unavailable',
        })
        getCertificateJobProgressHandlerMock.mockResolvedValue([failed])

        function PermissionHarness() {
            const [permissions, setPermissions] = useState<
                readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][]
            >(certificateProgressPermissions)
            return (
                <>
                    <button
                        type="button"
                        onClick={() => setPermissions([PERMISSIONS.PROXY_HOSTS_VIEW])}
                    >
                        Remove certificate permissions
                    </button>
                    <CertificateJobProgressObserver permissions={permissions} />
                </>
            )
        }

        await render(withQueryClient(<PermissionHarness />))
        await waitFor(() => getTaskToasts()[0]?.dataset.toastTone === 'error')
        expect(getButton('Retry')).toBeDefined()
        expect(getTaskToasts()[0]?.querySelector('a[href="/certificates"]')).not.toBeNull()

        await click(getButton('Remove certificate permissions'))
        await waitFor(
            () =>
                !getTaskToasts()[0]?.textContent?.includes('Retry') &&
                getTaskToasts()[0]?.querySelector('a[href="/certificates"]') === null,
        )
    })

    test('keeps active progress visible while route content changes', async () => {
        getCertificateJobProgressHandlerMock.mockResolvedValue([certificateJobFixture()])

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

        await waitFor(() => getTaskToasts()[0]?.dataset.toastTone === 'error')
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
        getProxyHostsHandlerMock.mockResolvedValueOnce([
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
        getProxyHostsHandlerMock.mockResolvedValueOnce(hosts)
        await renderPage(allManagementPermissions)
        await waitFor(() => getRows().length === 10)
        await click(getButton('Filters'))
        await click(getButton('Filter domains…'))
        const domainSearch = document.querySelector<HTMLInputElement>(
            'input[aria-label="Filter domains…"]',
        )!
        expect(document.activeElement).toBe(domainSearch)
        await setControlValue(domainSearch, 'selected')
        const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
        expect(options.map((option) => option.textContent?.trim())).toEqual([
            'All',
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
        expect(document.body.textContent).toContain('Loading proxy hosts')
        expect(document.body.textContent).not.toContain('0 proxy hosts')
        expect(document.body.textContent).not.toContain('of 0 proxy hosts')
        expect(document.querySelector('[aria-label="Rows per page"]')).toBeNull()
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

    test('keeps cached runtime status visible during a refresh', async () => {
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
    canRequestCertificate = false,
    mode,
    proxyHost,
}: {
    canDisable?: boolean
    canEnable?: boolean
    canAssignCertificates?: boolean
    canRequestCertificate?: boolean
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
            canRequestCertificate={canRequestCertificate}
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
    await waitFor(() => document.querySelector('#certificate-request-domains') !== null)
    expect(
        document.querySelector<HTMLTextAreaElement>('#certificate-request-domains')?.readOnly,
    ).toBe(true)
    expect(document.querySelector<HTMLInputElement>('#certificate-request-name')?.value).toBe(
        'app.example.com',
    )
    await setControlValue(
        document.querySelector<HTMLInputElement>('#certificate-request-name')!,
        'App TLS',
    )
    await click(document.querySelector('#certificate-request-terms')!)
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
    await waitFor(() => document.querySelector('#certificate-request-terms') !== null)
    await click(document.querySelector('#certificate-request-terms')!)
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
            await click(getButton('Save'))
            await waitForToast('error', 'The HTTP settings could not be saved.')
            expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
                'The HTTP settings could not be saved.',
            )
            expect(fields[2]?.value).toBe('120')
            await click(getButton('Save'))
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
            await click(getButton('Save'))
            await waitForToast('error', 'The HTTP settings could not be saved.')
            expect(dialog.textContent).not.toContain('The HTTP settings could not be saved.')
            expect(dialog.textContent).not.toContain('private transport failure')
        })
    }

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
        getProxyHostsHandlerMock.mockResolvedValueOnce([secureHost, disabledHost])

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
                button.textContent?.includes('Save and apply'),
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
        await click(getButton('Save'))
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
        await click(getButton('Save'))
        await waitForToast(
            'error',
            'The saved configuration changed while this editor was open. Reload it before saving; your draft has been kept.',
        )
        expect(readTimeout.value).toBe('120')
        expect(dialog.isConnected).toBeTrue()

        saveProxyHostConfigEditorHandlerMock.mockResolvedValueOnce({
            success: true,
            message: 'admin.proxyHosts.runtime.savedPending',
            runtimeStatus: 'pending',
        })
        await click(getButton('Save'))
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

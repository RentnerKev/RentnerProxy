import { certificateManagementQueryKeys } from '@/lib/Admin/CertificateManagement/certificateManagementCache.ts'
import { proxyHostManagementQueryKeys } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { QueryClient as QueryClientInstance } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { MAX_CERTIFICATE_DOMAINS } from '@/config/certificates.config.ts'
import type {
    CertificateActionResult,
    CertificateSummary,
} from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import { redirectHostManagementQueryKeys } from '@/lib/Admin/RedirectHostManagement/redirectHostManagementCache.ts'
import withTestLanguage, { withLanguageRoot } from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()

const { QueryClient, QueryClientProvider, QueryObserver } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { ToastProvider, toast } = await import('@rentnerkev/toasts')
const certificate: CertificateSummary = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54021',
    name: 'Public edge',
    domains: ['app.example.com', 'www.example.com'],
    source: 'acme',
    environment: 'staging',
    status: 'valid',
    operation: 'idle',
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-04-01T00:00:00Z'),
    issuer: 'Pebble',
    fingerprint: 'SHA256:fixture',
    candidate: null,
    dnsCleanupPending: false,
    lastErrorCode: null,
    assignedHostCount: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
}

const getCertificatesHandlerMock = mock(async (): Promise<CertificateSummary[]> => [certificate])
const getAssignableCertificatesHandlerMock = mock(async (): Promise<CertificateSummary[]> => [
    certificate,
])
const importCertificateHandlerMock = mock(async () => ({
    success: true as const,
    message: 'admin.certificates.messages.imported',
}))
const replaceCertificateHandlerMock = mock(async () => ({
    success: true as const,
    message: 'admin.certificates.messages.replaced',
}))
const requestCertificateHandlerMock = mock(async (): Promise<CertificateActionResult> => ({
    success: true as const,
    message: 'admin.certificates.messages.requested',
}))

const requestProxyHostCertificateHandlerMock = mock(async () => ({
    success: false as const,
    message: 'admin.proxyHosts.certificateJob.errors.actionFailed',
}))
const retryCertificateJobHandlerMock = mock(async () => ({
    success: false as const,
    message: 'admin.proxyHosts.certificateJob.errors.actionFailed',
}))

mock.module('@/features/Admin/ProxyHostManagement/CertificateJobs/middleware.ts', () => ({
    requestProxyHostCertificateHandler: requestProxyHostCertificateHandlerMock,
    retryCertificateJobHandler: retryCertificateJobHandlerMock,
}))
const renewCertificateHandlerMock = mock(async () => ({
    success: true as const,
    message: 'admin.certificates.messages.renewing',
}))
const deleteCertificateHandlerMock = mock(async (): Promise<CertificateActionResult> => ({
    success: true as const,
    message: 'admin.certificates.messages.deleted',
    runtimeStatus: 'applied' as const,
}))

const dnsProvider = {
    id: 'cloudflare' as const,
    capabilities: {
        zoneDiscovery: true,
        txtCreate: true,
        txtCleanup: true,
        addressRecordTypes: ['A', 'AAAA'] as const,
        proxyOptions: 'cloudflare' as const,
    },
}
let dnsProvidersUnavailable = false
const getCertificateDnsProviders = mock(async () => {
    if (dnsProvidersUnavailable) throw new Error('offline')
    return [dnsProvider]
})
const continueManualDnsHandlerMock = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.certificates.manualDns.checking',
}))
const cancelManualDnsHandlerMock = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.certificates.manualDns.cancelled',
}))
mock.module('@/features/Admin/CertificateManagement/middleware.ts', () => ({
    continueManualDnsHandler: continueManualDnsHandlerMock,
    cancelManualDnsHandler: cancelManualDnsHandlerMock,
    getCertificateDnsProvidersHandler: getCertificateDnsProviders,
    getCertificatesHandler: getCertificatesHandlerMock,
    getAssignableCertificatesHandler: getAssignableCertificatesHandlerMock,
    importCertificateHandler: importCertificateHandlerMock,
    replaceCertificateHandler: replaceCertificateHandlerMock,
    requestCertificateHandler: requestCertificateHandlerMock,
    renewCertificateHandler: renewCertificateHandlerMock,
    deleteCertificateHandler: deleteCertificateHandlerMock,
}))
const trustedCa = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54052',
    name: 'HomeLab Root CA',
    subject: 'CN=HomeLab Root CA',
    issuer: 'CN=HomeLab Root CA',
    fingerprintSha256: 'sha256:' + 'b'.repeat(64),
    notBefore: new Date('2026-01-01T00:00:00Z'),
    notAfter: new Date('2036-01-01T00:00:00Z'),
    assignedHostCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
}
const getTrustedCasHandlerMock = mock(async () => [trustedCa])
const createTrustedCaHandlerMock = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.trustedCas.messages.created',
    runtimeStatus: 'applied' as const,
}))
const replaceTrustedCaHandlerMock = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.trustedCas.messages.replaced',
    runtimeStatus: 'applied' as const,
}))
const deleteTrustedCaHandlerMock = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.trustedCas.messages.deleted',
    runtimeStatus: 'applied' as const,
}))
mock.module('@/features/Admin/TrustedCaManagement/middleware.ts', () => ({
    getTrustedCasHandler: getTrustedCasHandlerMock,
    getAssignableTrustedCasHandler: mock(async () => [trustedCa]),
    createTrustedCaHandler: createTrustedCaHandlerMock,
    replaceTrustedCaHandler: replaceTrustedCaHandlerMock,
    deleteTrustedCaHandler: deleteTrustedCaHandlerMock,
}))

const { default: CertificateManagementPage } =
    await import('@/features/Admin/CertificateManagement/index.tsx')
const { default: CertificateRequestModal } =
    await import('@/features/Admin/CertificateManagement/Components/CertificateRequestModal/index.tsx')

let activeRoot: Root | null = null
let activeQueryClient: QueryClientInstance | null = null

async function renderPage(
    permissions: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][],
    language: 'en' | 'de' | 'es' | 'fr' = 'en',
    content?: ReactElement,
): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeQueryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    activeRoot = withLanguageRoot(createRoot(container))
    await act(async () => {
        activeRoot?.render(
            <TooltipProvider>
                <ToastProvider {...TOAST_PROVIDER_PROPS} locale="en">
                    <QueryClientProvider client={activeQueryClient!}>
                        {withTestLanguage(
                            content ?? <CertificateManagementPage permissions={permissions} />,
                            language,
                        )}
                    </QueryClientProvider>
                </ToastProvider>
            </TooltipProvider>,
        )
    })
    return container
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
    await waitFor(() => document.querySelector('[role=menu]') !== null)
}

async function setValue(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
        const prototype =
            control instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value)
        control.dispatchEvent(new Event('input', { bubbles: true }))
        control.dispatchEvent(new Event('change', { bubbles: true }))
        await Promise.resolve()
    })
}

function certificateDomainInputs(): HTMLInputElement[] {
    return [
        ...document.querySelectorAll<HTMLInputElement>('input[id^="certificate-request-domain-"]'),
    ]
}

async function waitFor(condition: () => boolean, timeoutMs = 1_500): Promise<void> {
    const waitUntil = async (deadline: number): Promise<void> => {
        if (condition()) return
        if (Date.now() >= deadline) {
            expect(condition(), 'Timed out waiting for UI condition').toBeTrue()
            return
        }
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
        await waitUntil(deadline)
    }

    await waitUntil(Date.now() + timeoutMs)
}

async function waitForToast(tone: 'success' | 'error' | 'warning'): Promise<void> {
    await waitFor(() => document.querySelector('.rentnerproxy-toast-' + tone) !== null)
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
    })
}

function button(label: string): HTMLButtonElement {
    const match = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) =>
            candidate.textContent?.trim().includes(label) ||
            candidate.getAttribute('aria-label')?.includes(label),
    )
    expect(match).toBeDefined()
    return match!
}

function lastButton(label: string): HTMLButtonElement {
    const matches = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
        (candidate) => candidate.textContent?.trim().includes(label),
    )
    expect(matches.length).toBeGreaterThan(0)
    return matches.at(-1)!
}

async function chooseDnsChallenge(): Promise<void> {
    await click(document.querySelector('[aria-label="ACME challenge"]')!)
    await waitFor(() => document.querySelector('[role=option]') !== null)
    const dnsOption = [...document.querySelectorAll('[role=option]')].find((option) =>
        option.textContent?.includes('DNS-01'),
    )
    expect(dnsOption).toBeDefined()
    await click(dnsOption!)
}

/** Selects an ACME environment from the request form. */
async function chooseAcmeEnvironment(environment: 'Production' | 'Staging'): Promise<void> {
    await click(document.querySelector('[aria-label="ACME environment"]')!)
    await waitFor(() => document.querySelector('[role=option]') !== null)
    const option = [...document.querySelectorAll('[role=option]')].find(
        (candidate) => candidate.textContent?.trim() === environment,
    )
    expect(option).toBeDefined()
    await click(option!)
}

beforeEach(() => {
    continueManualDnsHandlerMock.mockClear()
    cancelManualDnsHandlerMock.mockClear()
    dnsProvidersUnavailable = false
    getCertificateDnsProviders.mockClear()
    toast.dismissAll()
    requestProxyHostCertificateHandlerMock.mockClear()
    retryCertificateJobHandlerMock.mockClear()
    getTrustedCasHandlerMock.mockReset().mockResolvedValue([trustedCa])
    createTrustedCaHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.trustedCas.messages.created',
        runtimeStatus: 'applied',
    })
    replaceTrustedCaHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.trustedCas.messages.replaced',
        runtimeStatus: 'applied',
    })
    deleteTrustedCaHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.trustedCas.messages.deleted',
        runtimeStatus: 'applied',
    })
    getCertificatesHandlerMock.mockReset().mockResolvedValue([certificate])
    getAssignableCertificatesHandlerMock.mockReset().mockResolvedValue([certificate])
    importCertificateHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.certificates.messages.imported',
    })
    replaceCertificateHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.certificates.messages.replaced',
    })
    requestCertificateHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.certificates.messages.requested',
    })
    renewCertificateHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.certificates.messages.renewing',
    })
    deleteCertificateHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.certificates.messages.deleted',
        runtimeStatus: 'applied',
    })
})

afterEach(async () => {
    await act(async () => {
        activeRoot?.unmount()
        await Promise.resolve()
    })
    activeRoot = null
    activeQueryClient?.clear()
    activeQueryClient = null
    document.body.innerHTML = ''
})

describe('certificate management UI', () => {
    test.each([undefined, '2026-10-01T12:00:00.000Z'])(
        'requires the actual proxy revision for a certificate request (%s)',
        async (expectedUpdatedAt) => {
            const proxyHostId = '018f2f52-7c1b-7cc0-9f3c-6a9952c54053'
            await renderPage(
                [],
                'en',
                <CertificateRequestModal
                    open
                    onOpenChange={() => {}}
                    onSuccess={() => {}}
                    proxyHostId={proxyHostId}
                    expectedUpdatedAt={expectedUpdatedAt}
                    initialDomains={['edge.example.com']}
                    initialName="Production edge"
                />,
            )
            await setValue(
                document.querySelector('#certificate-request-contact')!,
                'ops@example.com',
            )
            await click(lastButton('Request with ACME'))
            await waitForToast('error')

            if (expectedUpdatedAt) {
                expect(requestProxyHostCertificateHandlerMock).toHaveBeenCalledWith({
                    data: {
                        idempotencyKey: expect.any(String),
                        proxyHostId,
                        expectedUpdatedAt,
                        request: {
                            name: 'Production edge',
                            environment: 'production',
                            challengeType: 'http-01',
                            contactEmail: 'ops@example.com',
                            acceptTerms: true,
                        },
                    },
                })
            } else {
                expect(requestProxyHostCertificateHandlerMock).not.toHaveBeenCalled()
            }
            expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
            expect(retryCertificateJobHandlerMock).not.toHaveBeenCalled()
        },
    )

    test('filters exact certificate names with search and expiry dates with the calendar', async () => {
        const now = new Date()
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`
        const calendarDayLabel = new Date(now.getFullYear(), now.getMonth(), 15).toLocaleDateString(
            'en-US',
            { dateStyle: 'full' },
        )
        getCertificatesHandlerMock.mockResolvedValueOnce([
            { ...certificate, expiresAt: new Date(`${date}T23:59:59Z`) },
            {
                ...certificate,
                id: 'second-certificate',
                name: 'Public edge backup',
                expiresAt: null,
            },
            {
                ...certificate,
                id: 'later-certificate',
                name: 'Later expiry',
                expiresAt: new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000),
            },
        ])
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW])
        const table = document.querySelector('table')!
        const rows = () => table.querySelectorAll('tbody tr')
        await waitFor(() => document.body.textContent?.includes('Public edge backup') === true)
        await click(button('Filters'))
        await click(button('Filter Name…'))
        const search = document.querySelector<HTMLInputElement>(
            'input[placeholder="Filter Name…"]',
        )!
        await waitFor(() => document.activeElement === search)
        await setValue(search, 'Public edge')
        const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
            (item) => item.textContent?.trim() === 'Public edge',
        )!
        await click(option)
        await waitFor(() => rows().length === 1)
        expect(rows()[0]?.textContent).not.toContain('backup')
        await click(button('Reset filters'))
        await waitFor(() => rows().length === 3)
        const dateFilter = button('Filter by date range')
        const placeholder = [...dateFilter.querySelectorAll('span')].find(
            (span) => span.textContent === dateFilter.textContent,
        )
        expect(placeholder?.classList.contains('text-muted')).toBe(true)
        await click(dateFilter)
        const getCalendarDay = () =>
            [...document.querySelectorAll<HTMLButtonElement>('[data-calendar-day]')].find((day) =>
                day.getAttribute('aria-label')?.includes(calendarDayLabel),
            )!
        await click(getCalendarDay())
        await click(getCalendarDay())
        await waitFor(() => rows().length === 1)
        expect(rows()[0]?.textContent).toContain('Public edge')
        expect(rows()[0]?.textContent).not.toContain('backup')
    })

    test('shows certificate metadata to viewers without mutation actions', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        expect(document.body.textContent).toContain('Public edge')
        expect(document.body.textContent).toContain('Valid')
        const certificateRow = [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')].find(
            (row) => row.textContent?.includes('Public edge'),
        )!
        expect(
            [...certificateRow.querySelectorAll<HTMLAnchorElement>('a')]
                .map((link) => link.getAttribute('href'))
                .filter(Boolean),
        ).toEqual(['https://app.example.com', 'https://www.example.com'])
        expect(document.body.textContent).not.toContain('Import certificate')
        expect(document.body.textContent).not.toContain('Request with ACME')
        await openMenu(button('Open certificate actions'))
        expect(document.body.textContent).toContain('Details')
        expect(document.body.textContent).not.toContain('Renew')
        expect(document.body.textContent).not.toContain('Delete')
    })

    test('confirms the exact assigned-host HTTPS impact before deletion', async () => {
        getCertificatesHandlerMock.mockResolvedValueOnce([{ ...certificate, assignedHostCount: 3 }])
        await renderPage([
            PERMISSIONS.CERTIFICATES_VIEW,
            PERMISSIONS.CERTIFICATES_DELETE,
            PERMISSIONS.PROXY_HOSTS_UPDATE,
            PERMISSIONS.REDIRECT_HOSTS_UPDATE,
        ])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await openMenu(button('Open certificate actions'))
        await click(
            [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
                (item) => item.textContent?.trim() === 'Delete',
            )!,
        )
        await waitFor(() => document.querySelector('[role=dialog]') !== null)
        expect(document.body.textContent).toContain(
            'This certificate is currently used by 3 hosts.',
        )
        expect(document.body.textContent).toContain(
            'The hosts and their HTTP routing remain available.',
        )
        expect(deleteCertificateHandlerMock).not.toHaveBeenCalled()
        await click(lastButton('Delete'))
        await waitFor(() => deleteCertificateHandlerMock.mock.calls.length === 1)
        expect(deleteCertificateHandlerMock).toHaveBeenCalledWith({
            data: { certificateId: certificate.id },
        })
        await waitForToast('success')
    })

    test('warns when host cleanup is saved but certificate deletion awaits runtime sync', async () => {
        deleteCertificateHandlerMock.mockResolvedValueOnce({
            success: true,
            message: 'admin.certificates.messages.deletePending',
            runtimeStatus: 'pending',
        })
        await renderPage([
            PERMISSIONS.CERTIFICATES_VIEW,
            PERMISSIONS.CERTIFICATES_DELETE,
            PERMISSIONS.PROXY_HOSTS_UPDATE,
        ])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await openMenu(button('Open certificate actions'))
        await click(
            [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
                (item) => item.textContent?.trim() === 'Delete',
            )!,
        )
        await click(lastButton('Delete'))
        await waitForToast('warning')
        expect(document.body.textContent).toContain(
            'The certificate was kept and can be deleted after synchronization.',
        )
        expect(document.querySelector('[role=dialog]')).toBeNull()
    })

    test('uses a concise confirmation for an unassigned certificate', async () => {
        getCertificatesHandlerMock.mockResolvedValueOnce([{ ...certificate, assignedHostCount: 0 }])
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_DELETE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await openMenu(button('Open certificate actions'))
        await click(
            [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
                (item) => item.textContent?.trim() === 'Delete',
            )!,
        )
        await waitFor(() => document.querySelector('[role=dialog]') !== null)
        expect(document.body.textContent).toContain(
            'This permanently removes the unused certificate.',
        )
        expect(document.body.textContent).not.toContain('currently used by')
    })

    test('shows observed operation stages and durable certificate metadata without fake progress', async () => {
        const operationCertificate: CertificateSummary = {
            ...certificate,
            challengeType: 'dns-01',
            currentOperation: {
                id: '0192c8b4-6d5d-7c65-9dc0-7ac2c8ea0031',
                kind: 'renew',
                stage: 'waiting_for_validation',
                startedAt: new Date('2026-02-01T09:00:00Z'),
                updatedAt: new Date('2026-02-01T09:15:00Z'),
            },
            attemptCount: 2,
            nextAttemptAt: new Date('2026-02-01T10:00:00Z'),
            lastAttemptAt: new Date('2026-02-01T09:00:00Z'),
            lastSuccessAt: new Date('2026-01-01T00:00:00Z'),
            lastActivatedAt: new Date('2026-01-01T00:05:00Z'),
            lastErrorAt: null,
            nextRenewalAt: new Date('2026-03-01T00:00:00Z'),
        }
        getCertificatesHandlerMock.mockResolvedValueOnce([operationCertificate])
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_RENEW])
        await waitFor(() => document.body.textContent?.includes('Waiting for validation') === true)
        expect(document.body.textContent).toContain(operationCertificate.currentOperation!.id)
        expect(document.body.textContent).not.toContain('%')
        expect(document.querySelector('[role=progressbar]')).toBeNull()

        await openMenu(button('Open certificate actions'))
        const detailsAction = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
            (item) => item.textContent?.trim() === 'Details',
        )
        expect(detailsAction).toBeDefined()
        await click(detailsAction!)
        await waitFor(() => document.body.textContent?.includes('Certificate metadata') === true)
        expect(document.body.textContent).toContain(
            'Test environment – certificates are not trusted by normal browsers.',
        )
        expect(document.body.textContent).toContain('Valid until')
        expect(document.body.textContent).toContain('Automatic renewal')
        expect(document.body.textContent).toContain('Active ACME')
        expect(document.body.textContent).toContain('DNS-01 (Cloudflare)')
        expect(document.body.textContent).toContain('Subject alternative names (SAN)')
        expect(document.body.textContent).toContain('Next renewal')
        expect(document.body.textContent).toContain('Last activation')
        expect(document.body.textContent).toContain('Operation ID')
        expect(document.body.textContent).toContain('Operation stage')
        expect(document.body.textContent).toContain('Waiting for validation')
    })

    test('keeps completed operation history out of the table while preserving details and actions', async () => {
        const completedCertificate: CertificateSummary = {
            ...certificate,
            currentOperation: {
                id: '0192c8b4-6d5d-7c65-9dc0-7ac2c8ea0030',
                kind: 'renew',
                stage: 'applied',
                startedAt: new Date('2026-02-01T09:00:00Z'),
                updatedAt: new Date('2026-02-01T09:15:00Z'),
            },
        }
        getCertificatesHandlerMock.mockResolvedValueOnce([completedCertificate])
        await renderPage([
            PERMISSIONS.CERTIFICATES_VIEW,
            PERMISSIONS.CERTIFICATES_RENEW,
            PERMISSIONS.CERTIFICATES_DELETE,
        ])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)

        const row = document.querySelector<HTMLTableRowElement>('tbody tr')!
        expect(row.textContent).toContain('No operation in progress')
        expect(row.textContent).not.toContain('Applied')
        expect(row.textContent).not.toContain(completedCertificate.currentOperation!.id)

        await openMenu(button('Open certificate actions'))
        const renewAction = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
            (item) => item.textContent?.trim() === 'Renew',
        )
        expect(renewAction?.getAttribute('aria-disabled')).not.toBe('true')
        const deleteAction = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
            (item) => item.textContent?.trim() === 'Delete',
        )
        expect(deleteAction?.getAttribute('aria-disabled')).not.toBe('true')
        const detailsAction = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
            (item) => item.textContent?.trim() === 'Details',
        )
        await click(detailsAction!)
        await waitFor(() => document.body.textContent?.includes('Certificate metadata') === true)
        expect(document.body.textContent).toContain(completedCertificate.currentOperation!.id)
        expect(document.body.textContent).toContain('Renewal')
        expect(document.body.textContent).toContain('Applied')
    })

    test('keeps deletion available for a failed scheduled retry', async () => {
        const failedCertificate: CertificateSummary = {
            ...certificate,
            status: 'failed',
            issuedAt: null,
            expiresAt: null,
            issuer: null,
            fingerprint: null,
            lastErrorCode: 'acme_failed',
            nextAttemptAt: new Date('2026-02-01T10:42:00Z'),
            currentOperation: {
                id: '0192c8b4-6d5d-7c65-9dc0-7ac2c8ea0031',
                kind: 'issue',
                stage: 'retry_scheduled',
                startedAt: new Date('2026-02-01T09:00:00Z'),
                updatedAt: new Date('2026-02-01T09:15:00Z'),
            },
        }
        getCertificatesHandlerMock.mockResolvedValueOnce([failedCertificate])
        await renderPage([
            PERMISSIONS.CERTIFICATES_VIEW,
            PERMISSIONS.CERTIFICATES_RENEW,
            PERMISSIONS.CERTIFICATES_DELETE,
        ])
        await waitFor(() => document.body.textContent?.includes('Retry scheduled') === true)
        await openMenu(button('Open certificate actions'))

        const renewAction = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
            (item) => item.textContent?.trim() === 'Renew',
        )
        expect(renewAction?.getAttribute('aria-disabled')).toBe('true')
        const deleteAction = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
            (item) => item.textContent?.trim() === 'Delete',
        )
        expect(deleteAction?.getAttribute('aria-disabled')).not.toBe('true')
        await click(deleteAction!)
        await waitFor(() => document.querySelector('[role=dialog]') !== null)
    })

    test('keeps replace and delete available after a completed manual apply', async () => {
        const completedImport: CertificateSummary = {
            ...certificate,
            source: 'manual',
            environment: null,
            currentOperation: {
                id: '0192c8b4-6d5d-7c65-9dc0-7ac2c8ea0040',
                kind: 'import',
                stage: 'applied',
                startedAt: new Date('2026-02-01T09:00:00Z'),
                updatedAt: new Date('2026-02-01T09:15:00Z'),
            },
        }
        getCertificatesHandlerMock.mockResolvedValueOnce([completedImport])
        await renderPage([
            PERMISSIONS.CERTIFICATES_VIEW,
            PERMISSIONS.CERTIFICATES_UPDATE,
            PERMISSIONS.CERTIFICATES_DELETE,
        ])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        expect(document.querySelector('tbody tr')?.textContent).toContain(
            'No operation in progress',
        )

        await openMenu(button('Open certificate actions'))
        for (const label of ['Replace', 'Delete']) {
            const action = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
                (item) => item.textContent?.trim() === label,
            )
            expect(action?.getAttribute('aria-disabled')).not.toBe('true')
        }
    })

    test('searches current operation IDs without exposing completed operation history', async () => {
        const completed: CertificateSummary = {
            ...certificate,
            id: 'completed-certificate',
            currentOperation: {
                id: 'completed-operation-id',
                kind: 'issue',
                stage: 'applied',
                startedAt: new Date('2026-02-01T09:00:00Z'),
                updatedAt: new Date('2026-02-01T09:15:00Z'),
            },
        }
        const active: CertificateSummary = {
            ...certificate,
            id: 'active-certificate',
            name: 'Active certificate',
            operation: 'renewing',
            currentOperation: {
                id: 'active-operation-id',
                kind: 'renew',
                stage: 'waiting_for_validation',
                startedAt: new Date('2026-02-01T10:00:00Z'),
                updatedAt: new Date('2026-02-01T10:15:00Z'),
            },
        }
        getCertificatesHandlerMock.mockResolvedValueOnce([completed, active])
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW])
        await waitFor(() => document.querySelectorAll('tbody tr').length === 2)
        const search = document.querySelector<HTMLInputElement>('input[type="search"]')!

        await setValue(search, 'active-operation-id')
        await waitFor(() => document.querySelectorAll('tbody tr').length === 1)
        expect(document.querySelector('tbody tr')?.textContent).toContain('Active certificate')
        await setValue(search, 'completed-operation-id')
        await waitFor(
            () =>
                document
                    .querySelector('tbody tr')
                    ?.textContent?.includes('No certificates match your filters') === true,
        )
    })

    test('localizes the staging warning and keeps mutation actions disabled during an operation', async () => {
        const operationCertificate: CertificateSummary = {
            ...certificate,
            currentOperation: {
                id: '0192c8b4-6d5d-7c65-9dc0-7ac2c8ea0032',
                kind: 'renew',
                stage: 'applying',
                startedAt: new Date('2026-02-01T09:00:00Z'),
                updatedAt: new Date('2026-02-01T09:15:00Z'),
            },
        }
        getCertificatesHandlerMock.mockResolvedValueOnce([operationCertificate])
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_RENEW], 'de')
        await waitFor(
            () => document.body.textContent?.includes('Zertifikat wird angewendet') === true,
        )
        expect(document.body.textContent).toContain(operationCertificate.currentOperation!.id)
        await openMenu(button('Zertifikataktionen für Public edge öffnen'))
        const renewAction = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
            (item) => item.textContent?.trim() === 'Erneuern',
        )
        expect(renewAction).toBeDefined()
        expect(renewAction?.getAttribute('aria-disabled')).toBe('true')

        const detailsAction = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
            (item) => item.textContent?.trim() === 'Einzelheiten',
        )
        expect(detailsAction).toBeDefined()
        await click(detailsAction!)
        await waitFor(() => document.body.textContent?.includes('Zertifikatmetadaten') === true)
        expect(document.body.textContent).toContain(
            'Testumgebung – Zertifikate werden von normalen Browsern nicht als vertrauenswürdig eingestuft.',
        )
    })

    test('identifies manual imports as non-renewing certificates in details', async () => {
        const manualCertificate: CertificateSummary = {
            ...certificate,
            source: 'manual',
            environment: null,
            challengeType: null,
            currentOperation: null,
        }
        getCertificatesHandlerMock.mockResolvedValueOnce([manualCertificate])
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_UPDATE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await openMenu(button('Open certificate actions'))
        const detailsAction = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
            (item) => item.textContent?.trim() === 'Details',
        )
        expect(detailsAction).toBeDefined()
        await click(detailsAction!)
        await waitFor(() => document.body.textContent?.includes('Certificate metadata') === true)
        expect(document.body.textContent).toContain('Manual import')
        expect(document.body.textContent).not.toContain(
            'Test environment – certificates are not trusted by normal browsers.',
        )
    })

    test('shows pending candidates and retries activation through the renew action', async () => {
        const candidateCertificate: CertificateSummary = {
            ...certificate,
            dnsCleanupPending: true,
            candidate: {
                fingerprint: 'sha256:' + 'b'.repeat(64),
                issuedAt: new Date('2026-02-01T00:00:00Z'),
                expiresAt: new Date('2027-02-01T00:00:00Z'),
                lastErrorCode: 'runtime_apply_failed',
                nextAttemptAt: new Date('2026-02-01T10:42:00Z'),
            },
        }
        getCertificatesHandlerMock.mockResolvedValueOnce([candidateCertificate])
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_RENEW])
        await waitFor(() => document.body.textContent?.includes('Pending activation') === true)
        await openMenu(button('Open certificate actions'))
        expect(document.body.textContent).toContain('Retry activation')
        const detailsAction = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
            (item) => item.textContent?.trim() === 'Details',
        )
        expect(detailsAction).toBeDefined()
        await click(detailsAction!)
        await waitFor(() => document.body.textContent?.includes('Candidate fingerprint') === true)
        expect(document.body.textContent).toContain('10:42 UTC')
        expect(document.body.textContent).toContain('DNS cleanup is still pending')
        expect(document.body.textContent).toContain(certificate.fingerprint!)
        expect(document.body.textContent).toContain(candidateCertificate.candidate!.fingerprint)
        await click(button('Close dialog'))
        await waitFor(() => document.querySelector('[role=dialog]') === null)
        await openMenu(button('Open certificate actions'))
        const retryAction = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
            (item) => item.textContent?.trim() === 'Retry activation',
        )
        expect(retryAction).toBeDefined()
        await click(retryAction!)
        await waitFor(() => document.body.textContent?.includes('Retry activation') === true)
        await click(lastButton('Retry activation'))
        await waitFor(() => renewCertificateHandlerMock.mock.calls.length === 1)
        expect(renewCertificateHandlerMock).toHaveBeenCalledWith({
            data: { certificateId: certificate.id },
        })
    })

    test('submits manual PEM values directly and clears them after success', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_CREATE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        activeQueryClient!.setQueryData(redirectHostManagementQueryKeys.all, [])
        await click(button('Import certificate'))
        await waitFor(() => document.querySelector('#certificate-import-privateKeyPem') !== null)
        const certificatePem = '-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----'
        const privateKeyPem = generateKeyPairSync('ed25519')
            .privateKey.export({
                type: 'pkcs8',
                format: 'pem',
            })
            .toString()
        await setValue(document.querySelector('#certificate-import-name')!, 'Imported edge')
        await setValue(
            document.querySelector('#certificate-import-certificatePem')!,
            certificatePem,
        )
        await setValue(document.querySelector('#certificate-import-privateKeyPem')!, privateKeyPem)
        let finishRefresh: (() => void) | undefined
        getCertificatesHandlerMock.mockImplementationOnce(
            () =>
                new Promise<CertificateSummary[]>((resolve) => {
                    finishRefresh = () => resolve([certificate])
                }),
        )
        await click(lastButton('Import certificate'))
        await waitFor(() => importCertificateHandlerMock.mock.calls.length === 1)
        expect(importCertificateHandlerMock).toHaveBeenCalledWith({
            data: {
                name: 'Imported edge',
                certificatePem,
                privateKeyPem,
                chainPem: '',
            },
        })
        try {
            await waitFor(() => finishRefresh !== undefined)
            const submit = document.querySelector<HTMLButtonElement>(
                '[role=dialog] button[type=submit]',
            )
            expect(submit?.disabled).toBeTrue()
            expect(
                document.querySelector<HTMLTextAreaElement>('#certificate-import-privateKeyPem')
                    ?.value,
            ).toBe('')
        } finally {
            await act(async () => finishRefresh?.())
        }
        await waitFor(() => document.querySelector('[role=dialog]') === null)
        expect(
            activeQueryClient!.getQueryState(redirectHostManagementQueryKeys.all)?.isInvalidated,
        ).toBeTrue()
        expect(document.body.textContent).not.toContain(privateKeyPem)
        await waitForToast('success')
    })

    test('accepts ACME terms through the explicit request action without a checkbox or network banner', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Request with ACME'))
        await waitFor(() => document.querySelector('#certificate-request-domain-0') !== null)
        await setValue(document.querySelector('#certificate-request-name')!, 'Consent edge')
        await setValue(document.querySelector('#certificate-request-domain-0')!, 'edge.example.com')
        expect(document.querySelector('#certificate-request-terms')).toBeNull()
        expect(document.body.textContent).not.toContain('I accept the ACME terms of service')
        expect(document.body.textContent).not.toContain('ACME validation needs public DNS')
        const submit = lastButton('Request with ACME')
        const consent = document.getElementById(submit.getAttribute('aria-describedby')!)!
        expect(consent.textContent).toContain('By clicking “Request with ACME”, you accept the')
        expect(consent.querySelector('a')?.textContent).toBe('ACME terms of service')
        expect(consent.querySelector('a')?.getAttribute('href')).toBe(
            'https://letsencrypt.org/repository/',
        )
        expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
        await click(lastButton('Request with ACME'))
        await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
        expect(requestCertificateHandlerMock).toHaveBeenCalledWith({
            data: expect.objectContaining({
                name: 'Consent edge',
                domains: ['edge.example.com'],
                acceptTerms: true,
            }),
        })
    })

    test('opening and cancelling an ACME request issues no certificate', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Request with ACME'))
        await waitFor(() => document.querySelector('#certificate-request-domain-0') !== null)
        await setValue(document.querySelector('#certificate-request-name')!, 'Cancelled edge')
        await setValue(document.querySelector('#certificate-request-domain-0')!, 'edge.example.com')
        await click(lastButton('Cancel'))
        await waitFor(() => document.querySelector('[role=dialog]') === null)
        expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
        expect(requestProxyHostCertificateHandlerMock).not.toHaveBeenCalled()
    })

    test('requests production ACME by default with domains, contact, and accepted terms', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Request with ACME'))
        await waitFor(() => document.querySelector('#certificate-request-domain-0') !== null)
        expect(document.body.textContent).toContain(
            'Production issues a publicly trusted certificate for normal operation.',
        )
        await setValue(document.querySelector('#certificate-request-name')!, 'Production edge')
        await setValue(document.querySelector('#certificate-request-domain-0')!, 'edge.example.com')
        expect(button('Remove domain 1').disabled).toBeTrue()
        await click(button('Add another domain'))
        await setValue(
            document.querySelector('#certificate-request-domain-1')!,
            'remove.example.com',
        )
        await click(button('Add another domain'))
        const lastDomain = document.querySelector<HTMLInputElement>(
            '#certificate-request-domain-2',
        )!
        await setValue(lastDomain, 'www.edge.example.com')
        await click(button('Remove domain 2'))
        expect(document.querySelector('#certificate-request-domain-1')).toBe(lastDomain)
        expect(lastDomain.value).toBe('www.edge.example.com')
        await click(button('Add another domain'))
        expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
        await setValue(document.querySelector('#certificate-request-contact')!, 'ops@example.com')
        let finishRefresh: (() => void) | undefined
        getCertificatesHandlerMock.mockImplementationOnce(
            () =>
                new Promise<CertificateSummary[]>((resolve) => {
                    finishRefresh = () => resolve([certificate])
                }),
        )
        await click(lastButton('Request with ACME'))
        await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
        expect(requestCertificateHandlerMock).toHaveBeenCalledWith({
            data: {
                name: 'Production edge',
                domains: ['edge.example.com', 'www.edge.example.com'],
                environment: 'production',
                challengeType: 'http-01',
                contactEmail: 'ops@example.com',
                acceptTerms: true,
            },
        })
        try {
            await waitFor(() => finishRefresh !== undefined)
            expect(button('Add another domain').disabled).toBeTrue()
            expect(button('Remove domain 1').disabled).toBeTrue()
            expect(
                document.querySelector<HTMLInputElement>('#certificate-request-domain-0')?.disabled,
            ).toBeTrue()
            expect(
                document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')
                    ?.disabled,
            ).toBeTrue()
        } finally {
            await act(async () => finishRefresh?.())
        }
        await waitFor(() => document.querySelector('[role=dialog]') === null)
        await waitForToast('success')
    })

    test('limits certificate domain rows and allows adding again after removal', async () => {
        await renderPage(
            [],
            'en',
            <CertificateRequestModal
                open
                onOpenChange={() => {}}
                onSuccess={() => {}}
                initialDomains={Array.from(
                    { length: MAX_CERTIFICATE_DOMAINS },
                    (_, index) => `host-${index}.example.com`,
                )}
            />,
        )
        expect(certificateDomainInputs()).toHaveLength(MAX_CERTIFICATE_DOMAINS)
        expect(button('Add another domain').disabled).toBeTrue()
        await click(button('Remove domain 2'))
        expect(certificateDomainInputs()).toHaveLength(MAX_CERTIFICATE_DOMAINS - 1)
        expect(button('Add another domain').disabled).toBeFalse()
        await click(button('Add another domain'))
        expect(certificateDomainInputs()).toHaveLength(MAX_CERTIFICATE_DOMAINS)
        expect(certificateDomainInputs()[MAX_CERTIFICATE_DOMAINS - 1]?.value).toBe('')
        expect(button('Add another domain').disabled).toBeTrue()
        expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
    })

    test('shows every fixed host domain as read-only without domain editing actions', async () => {
        const domains = ['app.example.com', 'www.example.com']
        await renderPage(
            [],
            'en',
            <CertificateRequestModal
                open
                onOpenChange={() => {}}
                onSuccess={() => {}}
                initialDomains={domains}
                readOnlyDomains
            />,
        )
        const inputs = certificateDomainInputs()
        expect(inputs.map((input) => input.value)).toEqual(domains)
        expect(inputs.every((input) => input.readOnly)).toBeTrue()
        expect(document.body.textContent).not.toContain('Add another domain')
        expect(document.querySelector('button[aria-label^="Remove domain"]')).toBeNull()
    })

    test('keeps staging available as an explicitly selected test environment', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Request with ACME'))
        await waitFor(() => document.querySelector('#certificate-request-domain-0') !== null)
        await chooseAcmeEnvironment('Staging')
        expect(document.body.textContent).toContain(
            'Staging is a test environment; certificates are not trusted by normal browsers.',
        )
        await setValue(document.querySelector('#certificate-request-name')!, 'Staging edge')
        await setValue(document.querySelector('#certificate-request-domain-0')!, 'edge.example.com')
        let finishRefresh: (() => void) | undefined
        getCertificatesHandlerMock.mockImplementationOnce(
            () =>
                new Promise<CertificateSummary[]>((resolve) => {
                    finishRefresh = () => resolve([certificate])
                }),
        )
        await click(lastButton('Request with ACME'))
        await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
        expect(requestCertificateHandlerMock).toHaveBeenCalledWith({
            data: {
                name: 'Staging edge',
                domains: ['edge.example.com'],
                environment: 'staging',
                challengeType: 'http-01',
                contactEmail: '',
                acceptTerms: true,
            },
        })
        try {
            await waitFor(() => finishRefresh !== undefined)
            expect(
                document.querySelector('[aria-label="ACME environment"]')?.textContent,
            ).toContain('Production')
        } finally {
            await act(async () => finishRefresh?.())
        }
        await waitFor(() => document.querySelector('[role=dialog]') === null)
        await waitForToast('success')
    })

    test('catalogue failure blocks DNS-01 while HTTP-01 remains usable', async () => {
        dnsProvidersUnavailable = true
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Request with ACME'))
        await waitFor(() => document.querySelector('#certificate-request-domain-0') !== null)
        await setValue(
            document.querySelector('#certificate-request-name')!,
            'Offline DNS catalogue',
        )
        await setValue(document.querySelector('#certificate-request-domain-0')!, 'example.com')
        await chooseDnsChallenge()
        await setValue(document.querySelector('#certificate-request-dns-zone-id')!, 'a'.repeat(32))
        await setValue(
            document.querySelector('#certificate-request-dns-api-token')!,
            'catalogue-secret-token',
        )
        await click(lastButton('Request with ACME'))
        expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain('DNS provider capabilities are unavailable')
        expect(document.body.textContent).not.toContain('catalogue-secret-token')
        await click(document.querySelector('[aria-label="ACME challenge"]')!)
        await waitFor(() => !!document.querySelector('[role="option"]'))
        await click(
            [...document.querySelectorAll('[role="option"]')].find((option) =>
                option.textContent?.includes('HTTP-01'),
            )!,
        )
        await click(lastButton('Request with ACME'))
        await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
        expect(requestCertificateHandlerMock).toHaveBeenCalledWith({
            data: expect.objectContaining({ challengeType: 'http-01' }),
        })
    })

    test('forwards DNS-01 wildcard requests with Cloudflare credentials', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Request with ACME'))
        await waitFor(() => document.querySelector('#certificate-request-domain-0') !== null)
        await setValue(document.querySelector('#certificate-request-name')!, 'Wildcard edge')
        await setValue(document.querySelector('#certificate-request-domain-0')!, '*.example.com')
        await click(button('Add another domain'))
        await setValue(document.querySelector('#certificate-request-domain-1')!, 'example.com')
        await chooseDnsChallenge()
        await setValue(document.querySelector('#certificate-request-dns-zone-id')!, 'a'.repeat(32))
        await setValue(
            document.querySelector('#certificate-request-dns-api-token')!,
            'cloudflare-secret-token',
        )
        await click(lastButton('Request with ACME'))
        await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
        expect(requestCertificateHandlerMock).toHaveBeenCalledWith({
            data: {
                name: 'Wildcard edge',
                domains: ['*.example.com', 'example.com'],
                environment: 'production',
                challengeType: 'dns-01',
                dnsProvider: {
                    type: 'cloudflare',
                    zoneId: 'a'.repeat(32),
                    apiToken: 'cloudflare-secret-token',
                },
                contactEmail: '',
                acceptTerms: true,
            },
        })
    })

    test('shows provider validation toasts and allows correction and resubmission', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Request with ACME'))
        await waitFor(() => document.querySelector('#certificate-request-domain-0') !== null)
        await setValue(document.querySelector('#certificate-request-name')!, 'Wildcard edge')
        await setValue(document.querySelector('#certificate-request-domain-0')!, '*.example.com')
        await chooseDnsChallenge()
        await setValue(document.querySelector('#certificate-request-dns-zone-id')!, 'invalid-zone')
        await setValue(
            document.querySelector('#certificate-request-dns-api-token')!,
            'token with spaces',
        )
        await click(lastButton('Request with ACME'))
        await waitForToast('error')
        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
            'Enter a 32-character lowercase Cloudflare zone ID.',
        )
        expect(document.querySelector('form [role="alert"]')).toBeNull()
        expect(document.querySelector('#certificate-request-dns-zone-id-error')).toBeNull()
        expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
        await act(() => toast.dismissAll())
        await setValue(document.querySelector('#certificate-request-dns-zone-id')!, 'a'.repeat(32))
        expect(document.querySelector('.rentnerproxy-toast-error')).toBeNull()
        expect(lastButton('Request with ACME').disabled).toBeFalse()
        await click(lastButton('Request with ACME'))
        await waitForToast('error')
        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
            'Enter a valid Cloudflare API token without whitespace.',
        )
        expect(document.querySelector('#certificate-request-dns-api-token-error')).toBeNull()
        expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
        await setValue(
            document.querySelector('#certificate-request-dns-api-token')!,
            'fixture-token',
        )
        await click(lastButton('Request with ACME'))
        await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
    })

    test('shows the DNS-01 requirement as a toast for HTTP wildcard requests', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Request with ACME'))
        await waitFor(() => document.querySelector('#certificate-request-domain-0') !== null)
        await setValue(document.querySelector('#certificate-request-name')!, 'Wildcard edge')
        await setValue(document.querySelector('#certificate-request-domain-0')!, '*.example.com')
        await click(lastButton('Request with ACME'))
        await waitForToast('error')
        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
            'Wildcard names require the DNS-01 challenge.',
        )
        expect(document.querySelector('form [role="alert"]')).toBeNull()
        expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
    })

    test.each(['localhost', '192.0.2.1', 'app.demo.test'])(
        'reports invalid ACME domain %s only in a toast and accepts a corrected domain',
        async (domain) => {
            await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
            await waitFor(() => document.body.textContent?.includes('Public edge') === true)
            await click(button('Request with ACME'))
            await waitFor(() => document.querySelector('#certificate-request-domain-0') !== null)
            await setValue(document.querySelector('#certificate-request-name')!, 'Local ACME test')
            await setValue(document.querySelector('#certificate-request-domain-0')!, domain)
            expect(document.querySelector('.rentnerproxy-toast-error')).toBeNull()
            await click(lastButton('Request with ACME'))
            await waitForToast('error')
            expect(document.querySelectorAll('.rentnerproxy-toast-error')).toHaveLength(1)
            expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
                'Use a public DNS domain.',
            )
            expect(document.querySelector('#certificate-request-domain-0-error')).toBeNull()
            expect(document.querySelector('#certificate-request-domains-error')).toBeNull()
            expect(document.querySelector('form [role="alert"]')).toBeNull()
            expect(
                document
                    .querySelector('#certificate-request-domain-0')
                    ?.getAttribute('aria-invalid'),
            ).toBe('true')
            expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
            await act(() => toast.dismissAll())
            await click(lastButton('Request with ACME'))
            await waitForToast('error')
            expect(document.querySelectorAll('.rentnerproxy-toast-error')).toHaveLength(1)
            await setValue(
                document.querySelector('#certificate-request-domain-0')!,
                'acme-test.example.com',
            )
            await click(lastButton('Request with ACME'))
            await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
        },
    )
})

describe('trusted CA management UI', () => {
    const managePermissions = [
        PERMISSIONS.TRUSTED_CAS_VIEW,
        PERMISSIONS.TRUSTED_CAS_CREATE,
        PERMISSIONS.TRUSTED_CAS_UPDATE,
        PERMISSIONS.TRUSTED_CAS_DELETE,
    ]
    const bundle = '-----BEGIN CERTIFICATE-----\nY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----'

    async function openTrustedPage(
        permissions = managePermissions,
        language: 'en' | 'de' | 'es' | 'fr' = 'en',
    ) {
        await renderPage(permissions, language)
        await waitFor(() => document.body.textContent?.includes('HomeLab Root CA') === true)
    }

    test('trusted-only viewers see public metadata without fetching server certificates or mutation actions', async () => {
        await openTrustedPage([PERMISSIONS.TRUSTED_CAS_VIEW])
        expect(document.body.textContent).toContain(trustedCa.subject)
        expect(document.body.textContent).toContain(trustedCa.issuer)
        expect(document.body.textContent).toContain(trustedCa.fingerprintSha256)
        expect(document.body.textContent).toContain('2036')
        expect(document.body.textContent).not.toContain('Import trusted CA')
        expect(
            document.querySelector('button[aria-label="Actions for HomeLab Root CA"]'),
        ).toBeNull()
        expect(getCertificatesHandlerMock).not.toHaveBeenCalled()
        expect(document.querySelector('textarea[name="privateKeyPem"]')).toBeNull()
    })

    test('certificate tabs keep server certificates and trusted CAs separate', async () => {
        await renderPage([...managePermissions, PERMISSIONS.CERTIFICATES_VIEW])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        expect(getTrustedCasHandlerMock).not.toHaveBeenCalled()
        await click(button('Trusted CAs'))
        await waitFor(() => document.body.textContent?.includes('HomeLab Root CA') === true)
        expect(document.body.textContent).not.toContain('Public edge')
        await click(button('Server certificates'))
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
    })

    test('imports a named public CA bundle without any private-key field', async () => {
        await openTrustedPage()
        await click(button('Import trusted CA'))
        await waitFor(() => document.querySelector('textarea[name="pem"]') !== null)
        expect(document.querySelector('textarea[name="privateKeyPem"]')).toBeNull()
        expect(document.querySelector<HTMLTextAreaElement>('textarea[name="pem"]')!.maxLength).toBe(
            256 * 1024,
        )
        await setValue(document.querySelector('[role=dialog] input[name="name"]')!, 'Private PKI')
        await setValue(document.querySelector('textarea[name="pem"]')!, bundle)
        await click(lastButton('Import trusted CA'))
        await waitFor(() => createTrustedCaHandlerMock.mock.calls.length === 1)
        expect(createTrustedCaHandlerMock).toHaveBeenCalledWith({
            data: { name: 'Private PKI', pem: bundle },
        })
        await waitFor(() => document.querySelector('[role=dialog]') === null)
    })

    test('replace requires a new bundle and is independently permission gated', async () => {
        await openTrustedPage([PERMISSIONS.TRUSTED_CAS_VIEW, PERMISSIONS.TRUSTED_CAS_UPDATE])
        expect(document.body.textContent).not.toContain('Import trusted CA')
        await openMenu(button('Actions for HomeLab Root CA'))
        const replace = [...document.querySelectorAll('[role=menuitem]')].find((item) =>
            item.textContent?.includes('Replace CA bundle'),
        )!
        expect(replace).toBeDefined()
        expect(document.body.textContent).not.toContain('Delete trusted CA')
        await click(replace)
        await waitFor(() => document.querySelector('textarea[name="pem"]') !== null)
        expect(document.querySelector<HTMLTextAreaElement>('textarea[name="pem"]')!.value).toBe('')
        await setValue(document.querySelector('textarea[name="pem"]')!, bundle)
        await click(lastButton('Replace CA bundle'))
        await waitFor(() => replaceTrustedCaHandlerMock.mock.calls.length === 1)
        expect(replaceTrustedCaHandlerMock).toHaveBeenCalledWith({
            data: { name: trustedCa.name, pem: bundle, trustedCaId: trustedCa.id },
        })
    })

    test('unused CA deletion requires confirmation and passes only its ID', async () => {
        await openTrustedPage()
        await openMenu(button('Actions for HomeLab Root CA'))
        await click(
            [...document.querySelectorAll('[role=menuitem]')].find((item) =>
                item.textContent?.includes('Delete trusted CA'),
            )!,
        )
        await waitFor(() => document.querySelector('[role=dialog]') !== null)
        expect(deleteTrustedCaHandlerMock).not.toHaveBeenCalled()
        await click(lastButton('Delete trusted CA'))
        await waitFor(() => deleteTrustedCaHandlerMock.mock.calls.length === 1)
        expect(deleteTrustedCaHandlerMock).toHaveBeenCalledWith({
            data: { trustedCaId: trustedCa.id },
        })
    })

    test('assigned CAs cannot be deleted in the UI', async () => {
        getTrustedCasHandlerMock.mockResolvedValue([{ ...trustedCa, assignedHostCount: 1 }])
        await openTrustedPage()
        await openMenu(button('Actions for HomeLab Root CA'))
        const blocked = [...document.querySelectorAll('[role=menuitem]')].find((item) =>
            item.textContent?.includes('cannot delete'),
        )!
        expect(blocked).toBeDefined()
        expect(blocked.getAttribute('aria-disabled')).toBe('true')
        expect(deleteTrustedCaHandlerMock).not.toHaveBeenCalled()
    })

    test('invalid PEM with a private key is rejected before submission', async () => {
        await openTrustedPage()
        await click(button('Import trusted CA'))
        await waitFor(() => document.querySelector('textarea[name="pem"]') !== null)
        await setValue(document.querySelector('[role=dialog] input[name="name"]')!, 'Unsafe bundle')
        await setValue(
            document.querySelector('textarea[name="pem"]')!,
            bundle + '\n-----BEGIN PRIVATE KEY-----\nS0VZ\n-----END PRIVATE KEY-----',
        )
        await click(lastButton('Import trusted CA'))
        expect(createTrustedCaHandlerMock).not.toHaveBeenCalled()
        expect(document.querySelector('textarea[aria-invalid="true"]')).not.toBeNull()
    })

    for (const [language, title] of [
        ['en', 'Trusted CAs'],
        ['de', 'Vertrauenswürdige CAs'],
        ['es', 'CA de confianza'],
        ['fr', 'AC de confiance'],
    ] as const) {
        test('trusted CA page is localized in ' + language, async () => {
            await openTrustedPage([PERMISSIONS.TRUSTED_CAS_VIEW], language)
            expect(document.body.textContent).toContain(title)
            expect(document.body.textContent).not.toContain('admin.trustedCas.')
        })
    }
})

test.each(['certificate', 'trusted-ca'] as const)(
    'refetches active host roots and runtime queries once after %s deletion',
    async (kind) => {
        const isCertificate = kind === 'certificate'
        if (isCertificate)
            getCertificatesHandlerMock.mockResolvedValueOnce([
                { ...certificate, assignedHostCount: 0 },
            ])
        await renderPage(
            isCertificate
                ? [PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_DELETE]
                : [PERMISSIONS.TRUSTED_CAS_VIEW, PERMISSIONS.TRUSTED_CAS_DELETE],
        )
        await waitFor(
            () =>
                document.body.textContent?.includes(
                    isCertificate ? 'Public edge' : 'HomeLab Root CA',
                ) === true,
        )
        const keys = isCertificate
            ? [
                  proxyHostManagementQueryKeys.all,
                  proxyHostManagementQueryKeys.runtimeStatus,
                  redirectHostManagementQueryKeys.all,
                  redirectHostManagementQueryKeys.runtimeStatus,
              ]
            : [proxyHostManagementQueryKeys.all, proxyHostManagementQueryKeys.runtimeStatus]
        const counts = keys.map(() => 0)
        const subscriptions = keys.map((queryKey, index) =>
            new QueryObserver(activeQueryClient!, {
                queryKey,
                initialData: 0,
                staleTime: Infinity,
                queryFn: async () => ++counts[index]!,
            }).subscribe(() => undefined),
        )
        try {
            await openMenu(
                button(isCertificate ? 'Open certificate actions' : 'Actions for HomeLab Root CA'),
            )
            await click(
                [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
                    (item) =>
                        item.textContent?.trim() ===
                        (isCertificate ? 'Delete' : 'Delete trusted CA'),
                )!,
            )
            await waitFor(() => document.querySelector('[role=dialog]') !== null)
            await click(lastButton(isCertificate ? 'Delete' : 'Delete trusted CA'))
            await waitForToast('success')
            expect(counts).toEqual(keys.map(() => 1))
        } finally {
            subscriptions.forEach((unsubscribe) => unsubscribe())
        }
    },
)

const { default: CertificateDetailsModal } =
    await import('@/features/Admin/CertificateManagement/Components/CertificateDetailsModal/index.tsx')
const manualOperation: NonNullable<CertificateSummary['currentOperation']> = {
    id: '0198d98a-0000-7000-8000-000000000002',
    kind: 'renew',
    stage: 'awaiting_dns',
    dnsMode: 'manual',
    startedAt: new Date('2026-10-25T10:00:00Z'),
    updatedAt: new Date('2026-10-25T10:01:00Z'),
    manualDns: {
        challengeSetId: '0198d98a-0000-7000-8000-000000000003',
        status: 'awaiting_input',
        expiresAt: '2026-10-25T11:00:00Z',
        lastCheckedAt: null,
        lastErrorCode: null,
        records: [
            {
                identifier: 'example.com',
                owner: '_acme-challenge.example.com',
                value: 'a'.repeat(43),
                expiresAt: '2026-10-25T11:00:00Z',
            },
            {
                identifier: '*.example.com',
                owner: '_acme-challenge.example.com',
                value: 'b'.repeat(43),
                expiresAt: '2026-10-25T11:00:00Z',
            },
        ],
    },
}

const preparedManualCertificate: CertificateSummary = {
    ...certificate,
    id: '0198d98a-0000-7000-8000-000000000001',
    name: 'Manual edge',
    domains: ['example.com', '*.example.com'],
    environment: 'production',
    status: 'pending',
    operation: 'issuing',
    challengeType: 'dns-01',
    currentOperation: {
        ...manualOperation,
        kind: 'issue',
        manualDns: {
            ...manualOperation.manualDns!,
            expiresAt: '2099-01-01T00:00:00Z',
            records: manualOperation.manualDns!.records.map((record) => ({
                identifier: record.identifier,
                owner: record.owner,
                value: record.value,
                expiresAt: '2099-01-01T00:00:00Z',
            })),
        },
    },
}

async function openManualSetup(onSuccess = mock(() => undefined), start = true): Promise<void> {
    await renderPage(
        [],
        'en',
        <CertificateRequestModal open onOpenChange={() => undefined} onSuccess={onSuccess} />,
    )
    await setValue(document.querySelector('#certificate-request-name')!, 'Manual edge')
    await setValue(certificateDomainInputs()[0]!, 'example.com')
    await click(button('Add another domain'))
    await setValue(certificateDomainInputs()[1]!, '*.example.com')
    await click(document.querySelector('[aria-label="ACME challenge"]')!)
    await waitFor(() => !!document.querySelector('[role=option]'))
    await click(
        [...document.querySelectorAll('[role=option]')].find((option) =>
            option.textContent?.includes('Manual TXT records'),
        )!,
    )
    expect(button('Set up TXT records').className).toContain('bg-accent')
    expect(document.querySelector('[id$=acme-consent]')?.textContent).toContain(
        'Set up TXT records',
    )
    expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
    if (start) {
        await click(button('Set up TXT records'))
        await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
    }
}

function mockManualPreparation(prepared = preparedManualCertificate): void {
    getCertificatesHandlerMock.mockResolvedValue([certificate, prepared])
    requestCertificateHandlerMock.mockResolvedValue({
        success: true,
        message: 'admin.certificates.messages.requested',
        certificateId: prepared.id,
    })
}

async function prepareManualRecords(): Promise<void> {
    await waitFor(
        () =>
            document.querySelector<HTMLInputElement>('#manual-dns-setup-value-0')?.value ===
            'a'.repeat(43),
    )
}

async function confirmManualRecords(): Promise<void> {
    expect(button('Done').disabled).toBeFalse()
    await click(button('Done'))
}

test('manual setup starts from the primary setup action, preserves duplicate-owner TXT values, and continues the same order', async () => {
    dnsProvidersUnavailable = true
    mockManualPreparation()
    const onSuccess = mock(() => undefined)
    const writeText = mock(async (_value: string) => undefined)
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
        await openManualSetup(onSuccess)
        expect(lastButton('Request with ACME').disabled).toBeTrue()
        expect(requestCertificateHandlerMock).toHaveBeenCalledTimes(1)
        expect(continueManualDnsHandlerMock).not.toHaveBeenCalled()
        expect(document.querySelector('#certificate-request-dns-api-token')).toBeNull()
        expect(document.body.textContent).not.toContain('Every renewal needs your help')
        expect(getCertificateDnsProviders).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain('ACME')
        await prepareManualRecords()
        expect(requestCertificateHandlerMock).toHaveBeenCalledTimes(1)
        expect(requestCertificateHandlerMock).toHaveBeenCalledWith({
            data: expect.objectContaining({
                name: 'Manual edge',
                dnsMode: 'manual',
                challengeType: 'dns-01',
                domains: ['example.com', '*.example.com'],
                acceptTerms: true,
            }),
        })
        expect(onSuccess).not.toHaveBeenCalled()
        expect(lastButton('Request with ACME').disabled).toBeTrue()
        expect(document.querySelector<HTMLInputElement>('#manual-dns-setup-value-1')?.value).toBe(
            'b'.repeat(43),
        )
        expect(
            [...document.querySelectorAll<HTMLInputElement>('[id^=manual-dns-setup-owner-]')].map(
                (input) => input.value,
            ),
        ).toEqual(['_acme-challenge.example.com', '_acme-challenge.example.com'])
        expect(document.body.textContent).toContain('TXT')
        const guide = [...document.querySelectorAll('[role=dialog]')].at(-1)!
        expect(guide.querySelector('input[type=checkbox]')).toBeNull()
        expect(
            [...guide.querySelectorAll('footer button')].map((item) => item.textContent?.trim()),
        ).toEqual(['Done'])
        expect(
            [...guide.querySelectorAll('button')].map((item) => item.textContent?.trim()),
        ).not.toContain('Next')
        expect(
            [...guide.querySelectorAll('button')].map((item) => item.textContent?.trim()),
        ).not.toContain('Back')
        expect(guide.textContent).not.toContain('Step 2')
        await click(button('Copy owner'))
        expect(writeText).toHaveBeenCalledWith('_acme-challenge.example.com')
        await click(button('Copy value'))
        expect(writeText).toHaveBeenCalledWith('a'.repeat(43))
        expect(getCertificateDnsProviders).not.toHaveBeenCalled()
        expect(JSON.stringify(requestCertificateHandlerMock.mock.calls)).not.toContain(
            'dnsProvider',
        )
        await confirmManualRecords()
        expect(document.querySelector('#certificate-request-name')).not.toBeNull()
        expect(
            document.querySelector<HTMLInputElement>('#certificate-request-name')!.disabled,
        ).toBeTrue()
        await click(lastButton('Request with ACME'))
        await waitFor(() => continueManualDnsHandlerMock.mock.calls.length === 1)
        expect(continueManualDnsHandlerMock).toHaveBeenCalledWith({
            data: {
                certificateId: preparedManualCertificate.id,
                operationId: manualOperation.id,
                challengeSetId: manualOperation.manualDns!.challengeSetId,
            },
        })
        expect(requestCertificateHandlerMock).toHaveBeenCalledTimes(1)
        expect(onSuccess).toHaveBeenCalledWith(preparedManualCertificate.id)
    } finally {
        if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
        else Reflect.deleteProperty(navigator, 'clipboard')
    }
})

test('manual DNS details preserve two TXT values with one owner and fence continue/cancel actions', async () => {
    const writeText = mock(async (_value: string) => undefined)
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
        await renderPage(
            [],
            'en',
            <CertificateDetailsModal
                open
                onOpenChange={() => undefined}
                canRenew
                certificate={{
                    ...certificate,
                    operation: 'renewing',
                    currentOperation: manualOperation,
                }}
            />,
        )
        const dialog = document.querySelector('[role=dialog]')!
        expect(dialog.textContent).toContain('a'.repeat(43))
        expect(dialog.textContent).toContain('b'.repeat(43))
        expect(dialog.textContent).toContain('*.example.com')
        expect(dialog.textContent).toContain('Manual TXT records')
        expect(dialog.textContent).not.toContain('Every renewal needs your help')
        expect(dialog.textContent).not.toContain('Active ACME')
        await click(button('Copy value'))
        expect(writeText).toHaveBeenCalledWith('a'.repeat(43))
        await click(button('Check DNS and continue'))
        await waitFor(() => continueManualDnsHandlerMock.mock.calls.length === 1)
        const data = {
            certificateId: certificate.id,
            operationId: manualOperation.id,
            challengeSetId: manualOperation.manualDns!.challengeSetId,
        }
        expect(continueManualDnsHandlerMock).toHaveBeenCalledWith({ data })
        await waitFor(() => !button('Cancel validation').disabled)
        await click(button('Cancel validation'))
        await waitFor(() => cancelManualDnsHandlerMock.mock.calls.length === 1)
        expect(cancelManualDnsHandlerMock).toHaveBeenCalledWith({ data })
    } finally {
        if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
        else Reflect.deleteProperty(navigator, 'clipboard')
    }
})

test.each(['checking_dns', 'validating', 'complete', 'expired', 'cancelled'] as const)(
    'manual DNS %s cannot be continued or cancelled',
    async (status) => {
        await renderPage(
            [],
            'en',
            <CertificateDetailsModal
                open
                canRenew
                onOpenChange={() => undefined}
                certificate={{
                    ...certificate,
                    currentOperation: {
                        ...manualOperation,
                        manualDns: { ...manualOperation.manualDns!, status },
                    },
                }}
            />,
        )
        expect(
            [...document.querySelectorAll('button')].some((item) =>
                item.textContent?.includes('Check DNS and continue'),
            ),
        ).toBeFalse()
        expect(
            [...document.querySelectorAll('button')].some((item) =>
                item.textContent?.includes('Cancel validation'),
            ),
        ).toBeFalse()
        if (['complete', 'expired', 'cancelled'].includes(status))
            expect(document.body.textContent).toContain(
                'Remove only the exact TXT values shown above',
            )
    },
)

test('manual renewal details with issue permission alone expose records without renewal actions', async () => {
    await renderPage(
        [],
        'en',
        <CertificateDetailsModal
            open
            canIssue
            onOpenChange={() => undefined}
            certificate={{ ...certificate, currentOperation: manualOperation }}
        />,
    )
    expect(document.body.textContent).toContain('a'.repeat(43))
    expect(
        [...document.querySelectorAll('button')].some((item) =>
            item.textContent?.includes('Check DNS and continue'),
        ),
    ).toBeFalse()
})

test('manual setup shows delayed real records and reopens without creating another order', async () => {
    mockManualPreparation({
        ...preparedManualCertificate,
        currentOperation: {
            ...preparedManualCertificate.currentOperation!,
            stage: 'creating_order',
            manualDns: undefined,
        },
    })
    await openManualSetup()
    await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
    await waitFor(() => getCertificatesHandlerMock.mock.calls.length > 0)
    expect(document.body.textContent).not.toContain('a'.repeat(43))
    expect(button('Done').disabled).toBeTrue()
    expect(continueManualDnsHandlerMock).not.toHaveBeenCalled()
    await act(async () => {
        activeQueryClient!.setQueryData(certificateManagementQueryKeys.all, [
            certificate,
            preparedManualCertificate,
        ])
    })
    await waitFor(
        () =>
            document.querySelector<HTMLInputElement>('#manual-dns-setup-value-0')?.value ===
            'a'.repeat(43),
    )
    expect(document.querySelector<HTMLInputElement>('#manual-dns-setup-value-1')?.value).toBe(
        'b'.repeat(43),
    )
    await confirmManualRecords()
    await click(button('Set up TXT records'))
    await waitFor(
        () =>
            document.querySelector<HTMLInputElement>('#manual-dns-setup-value-0')?.value ===
            'a'.repeat(43),
    )
    expect(requestCertificateHandlerMock).toHaveBeenCalledTimes(1)
    expect(continueManualDnsHandlerMock).not.toHaveBeenCalled()
})

test('certificate detail selection from a binding-job link opens after its metadata arrives', async () => {
    getCertificatesHandlerMock.mockResolvedValue([certificate])
    await renderPage(
        [],
        'en',
        <CertificateManagementPage
            permissions={[PERMISSIONS.CERTIFICATES_VIEW]}
            selectedCertificateId={certificate.id}
        />,
    )
    await waitFor(
        () =>
            document
                .querySelector('[role=dialog]')
                ?.textContent?.includes('Certificate metadata') === true,
    )
    expect(document.querySelector('[role=dialog]')?.textContent).toContain(certificate.name)
    const close = document.querySelector<HTMLButtonElement>(
        '[role=dialog] button[aria-label="Close dialog"]',
    )
    if (close) {
        await click(close)
        expect(document.querySelector('[role=dialog]')).toBeNull()
    }
})

test('manual setup retains the accepted order after list refresh failure and retries loading it', async () => {
    mockManualPreparation()
    getCertificatesHandlerMock.mockRejectedValue(new Error('follow-up list unavailable'))
    await openManualSetup()
    await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
    await waitForToast('error')
    expect(document.body.textContent).not.toContain('a'.repeat(43))
    expect(button('Done').disabled).toBeTrue()
    getCertificatesHandlerMock.mockResolvedValue([certificate, preparedManualCertificate])
    await click(button('Retry'))
    await waitFor(
        () =>
            document.querySelector<HTMLInputElement>('#manual-dns-setup-value-0')?.value ===
            'a'.repeat(43),
    )
    expect(requestCertificateHandlerMock).toHaveBeenCalledTimes(1)
    expect(continueManualDnsHandlerMock).not.toHaveBeenCalled()
})

test.each(['expired', 'operation-replaced', 'challenge-replaced'] as const)(
    'manual setup blocks continuation when the prepared proof is %s',
    async (reason) => {
        mockManualPreparation()
        await openManualSetup()
        await prepareManualRecords()
        await confirmManualRecords()
        const operation = preparedManualCertificate.currentOperation!
        const changed: CertificateSummary = {
            ...preparedManualCertificate,
            currentOperation: {
                ...operation,
                id:
                    reason === 'operation-replaced'
                        ? '0198d98a-0000-7000-8000-000000000099'
                        : operation.id,
                manualDns: {
                    ...operation.manualDns!,
                    challengeSetId:
                        reason === 'challenge-replaced'
                            ? '0198d98a-0000-7000-8000-000000000098'
                            : operation.manualDns!.challengeSetId,
                    status: reason === 'expired' ? 'expired' : 'awaiting_input',
                    expiresAt:
                        reason === 'expired'
                            ? '2000-01-01T00:00:00Z'
                            : operation.manualDns!.expiresAt,
                },
            },
        }
        await act(async () => {
            activeQueryClient!.setQueryData(certificateManagementQueryKeys.all, [
                certificate,
                changed,
            ])
        })
        await waitFor(() => lastButton('Request with ACME').disabled)
        await act(async () => {
            document
                .querySelector('#certificate-request-name')!
                .closest('form')!
                .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        })
        expect(continueManualDnsHandlerMock).not.toHaveBeenCalled()
        expect(requestCertificateHandlerMock).toHaveBeenCalledTimes(1)
    },
)

test('manual setup validates invalid domains before opening and allows correction', async () => {
    await renderPage(
        [],
        'en',
        <CertificateRequestModal open onOpenChange={() => undefined} onSuccess={() => undefined} />,
    )
    await setValue(document.querySelector('#certificate-request-name')!, 'Invalid manual edge')
    await setValue(certificateDomainInputs()[0]!, 'localhost')
    await click(document.querySelector('[aria-label="ACME challenge"]')!)
    await waitFor(() => !!document.querySelector('[role=option]'))
    await click(
        [...document.querySelectorAll('[role=option]')].find((option) =>
            option.textContent?.includes('Manual TXT records'),
        )!,
    )
    await click(button('Set up TXT records'))
    await waitForToast('error')
    expect(document.querySelector('[id^=manual-dns-setup-value-]')).toBeNull()
    expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
    await setValue(certificateDomainInputs()[0]!, 'example.com')
    await click(button('Set up TXT records'))
    await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
})

test('manual setup accepts CA authorization reuse without inventing TXT records or continuing DNS', async () => {
    mockManualPreparation({
        ...preparedManualCertificate,
        status: 'valid',
        operation: 'idle',
        currentOperation: {
            ...preparedManualCertificate.currentOperation!,
            stage: 'applied',
            manualDns: undefined,
        },
    })
    const onSuccess = mock(() => undefined)
    await openManualSetup(onSuccess)
    await waitFor(() =>
        [...document.querySelectorAll('button')].some(
            (item) => item.textContent?.trim() === 'Done',
        ),
    )
    expect(document.querySelector('[id^=manual-dns-setup-value-]')).toBeNull()
    expect(document.querySelector('input[type=checkbox]')).toBeNull()
    await click(button('Done'))
    await click(lastButton('Request with ACME'))
    await waitFor(() => onSuccess.mock.calls.length === 1)
    expect(onSuccess).toHaveBeenCalledWith(preparedManualCertificate.id)
    expect(requestCertificateHandlerMock).toHaveBeenCalledTimes(1)
    expect(continueManualDnsHandlerMock).not.toHaveBeenCalled()
})

test('manual setup ignores repeated setup clicks while the accepted request is pending', async () => {
    getCertificatesHandlerMock.mockResolvedValue([certificate, preparedManualCertificate])
    let accept: ((result: CertificateActionResult) => void) | undefined
    requestCertificateHandlerMock.mockImplementation(
        () =>
            new Promise((resolve) => {
                accept = resolve
            }),
    )
    await openManualSetup(
        mock(() => undefined),
        false,
    )
    const prepare = button('Set up TXT records')
    await click(prepare)
    await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
    expect(prepare.disabled).toBeTrue()
    await click(prepare)
    expect(requestCertificateHandlerMock).toHaveBeenCalledTimes(1)
    await act(async () => {
        accept!({
            success: true,
            message: 'admin.certificates.messages.requested',
            certificateId: preparedManualCertificate.id,
        })
    })
    await waitFor(
        () =>
            document.querySelector<HTMLInputElement>('#manual-dns-setup-value-0')?.value ===
            'a'.repeat(43),
    )
    expect(requestCertificateHandlerMock).toHaveBeenCalledTimes(1)
})

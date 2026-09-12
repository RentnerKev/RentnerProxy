import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { QueryClient as QueryClientInstance } from '@tanstack/react-query'
import type { Root } from 'react-dom/client'

import { PERMISSIONS } from '../config/permissions.config'
import type { CertificateSummary } from '../shared/Types/certificates.types'
import { redirectHostManagementQueryKeys } from '../features/Admin/RedirectHostManagement/queryKeys'
import withTestLanguage, { withLanguageRoot } from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('../shared/Tooltip')
const { default: ToastProvider } = await import('../shared/Toast/Components/ToastProvider')
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
const getCertificateDetailsHandlerMock = mock(async () => certificate)
const importCertificateHandlerMock = mock(async () => ({
    success: true as const,
    message: 'admin.certificates.messages.imported',
}))
const replaceCertificateHandlerMock = mock(async () => ({
    success: true as const,
    message: 'admin.certificates.messages.replaced',
}))
const requestCertificateHandlerMock = mock(async () => ({
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

mock.module('../features/Admin/ProxyHostManagement/CertificateJobs/server', () => ({
    requestProxyHostCertificateHandler: requestProxyHostCertificateHandlerMock,
    retryCertificateJobHandler: retryCertificateJobHandlerMock,
}))
const renewCertificateHandlerMock = mock(async () => ({
    success: true as const,
    message: 'admin.certificates.messages.renewing',
}))
const deleteCertificateHandlerMock = mock(async () => ({
    success: true as const,
    message: 'admin.certificates.messages.deleted',
}))

mock.module('../features/Admin/CertificateManagement/server', () => ({
    getCertificatesHandler: getCertificatesHandlerMock,
    getAssignableCertificatesHandler: getAssignableCertificatesHandlerMock,
    getCertificateDetailsHandler: getCertificateDetailsHandlerMock,
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
mock.module('../features/Admin/TrustedCaManagement/server', () => ({
    getTrustedCasHandler: getTrustedCasHandlerMock,
    getAssignableTrustedCasHandler: mock(async () => [trustedCa]),
    createTrustedCaHandler: createTrustedCaHandlerMock,
    replaceTrustedCaHandler: replaceTrustedCaHandlerMock,
    deleteTrustedCaHandler: deleteTrustedCaHandlerMock,
}))

const { default: CertificateManagementPage } =
    await import('../features/Admin/CertificateManagement')

let activeRoot: Root | null = null
let activeQueryClient: QueryClientInstance | null = null

async function renderPage(
    permissions: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][],
    language: 'en' | 'de' | 'es' | 'fr' = 'en',
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
                <ToastProvider>
                    <QueryClientProvider client={activeQueryClient!}>
                        {withTestLanguage(
                            <CertificateManagementPage permissions={permissions} />,
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
    await waitFor(() => document.querySelector('[data-toast-tone=' + tone + ']') !== null)
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

beforeEach(() => {
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
    getCertificateDetailsHandlerMock.mockReset().mockResolvedValue(certificate)
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
    test('shows certificate metadata to viewers without mutation actions', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        expect(document.body.textContent).toContain('Public edge')
        expect(document.body.textContent).toContain('Valid')
        expect(document.body.textContent).not.toContain('Import certificate')
        expect(document.body.textContent).not.toContain('Request with ACME')
        await openMenu(button('Open certificate actions'))
        expect(document.body.textContent).toContain('Details')
        expect(document.body.textContent).not.toContain('Renew')
        expect(document.body.textContent).not.toContain('Delete')
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

    test('requests staging ACME by default with domains, contact, and accepted terms', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Request with ACME'))
        await waitFor(() => document.querySelector('#certificate-request-domains') !== null)
        await setValue(document.querySelector('#certificate-request-name')!, 'Staging edge')
        await setValue(
            document.querySelector('#certificate-request-domains')!,
            'edge.example.com\nwww.edge.example.com',
        )
        await setValue(document.querySelector('#certificate-request-contact')!, 'ops@example.com')
        await click(document.querySelector('#certificate-request-terms')!)
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
                domains: ['edge.example.com', 'www.edge.example.com'],
                environment: 'staging',
                challengeType: 'http-01',
                contactEmail: 'ops@example.com',
                acceptTerms: true,
            },
        })
        try {
            await waitFor(() => finishRefresh !== undefined)
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

    test('forwards DNS-01 wildcard requests with Cloudflare credentials', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Request with ACME'))
        await waitFor(() => document.querySelector('#certificate-request-domains') !== null)
        await setValue(document.querySelector('#certificate-request-name')!, 'Wildcard edge')
        await setValue(
            document.querySelector('#certificate-request-domains')!,
            '*.example.com\nexample.com',
        )
        await chooseDnsChallenge()
        await setValue(document.querySelector('#certificate-request-dns-zone-id')!, 'a'.repeat(32))
        await setValue(
            document.querySelector('#certificate-request-dns-api-token')!,
            'cloudflare-secret-token',
        )
        await click(document.querySelector('#certificate-request-terms')!)
        await click(lastButton('Request with ACME'))
        await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
        expect(requestCertificateHandlerMock).toHaveBeenCalledWith({
            data: {
                name: 'Wildcard edge',
                domains: ['*.example.com', 'example.com'],
                environment: 'staging',
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

    test('shows inline DNS provider validation errors before requesting', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Request with ACME'))
        await waitFor(() => document.querySelector('#certificate-request-domains') !== null)
        await setValue(document.querySelector('#certificate-request-domains')!, '*.example.com')
        await chooseDnsChallenge()
        await setValue(document.querySelector('#certificate-request-dns-zone-id')!, 'invalid-zone')
        await setValue(
            document.querySelector('#certificate-request-dns-api-token')!,
            'token with spaces',
        )
        await click(document.querySelector('#certificate-request-terms')!)
        await click(lastButton('Request with ACME'))
        await waitFor(
            () =>
                document.body.textContent?.includes(
                    'Enter a 32-character lowercase Cloudflare zone ID.',
                ) === true,
        )
        expect(document.body.textContent).toContain(
            'Enter a valid Cloudflare API token without whitespace.',
        )
        expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
    })

    test('shows an inline DNS-01 requirement for HTTP wildcard requests', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Request with ACME'))
        await waitFor(() => document.querySelector('#certificate-request-domains') !== null)
        await setValue(document.querySelector('#certificate-request-domains')!, '*.example.com')
        await click(document.querySelector('#certificate-request-terms')!)
        await click(lastButton('Request with ACME'))
        await waitFor(
            () =>
                document.body.textContent?.includes(
                    'Wildcard names require the DNS-01 challenge.',
                ) === true,
        )
        expect(requestCertificateHandlerMock).not.toHaveBeenCalled()
    })
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

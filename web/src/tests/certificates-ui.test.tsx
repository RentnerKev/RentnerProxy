import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { QueryClient as QueryClientInstance } from '@tanstack/react-query'
import type { Root } from 'react-dom/client'

import { PERMISSIONS } from '../config/permissions.config'
import type { CertificateSummary } from '../shared/Types/certificates.types'
import { withLanguageRoot } from './Helpers/withTestLanguage'

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
const { default: CertificateManagementPage } =
    await import('../features/Admin/CertificateManagement')

let activeRoot: Root | null = null
let activeQueryClient: QueryClientInstance | null = null

async function renderPage(
    permissions: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][],
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
                        <CertificateManagementPage permissions={permissions} />
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

beforeEach(() => {
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

    test('submits manual PEM values directly and clears them after success', async () => {
        await renderPage([PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_CREATE])
        await waitFor(() => document.body.textContent?.includes('Public edge') === true)
        await click(button('Import certificate'))
        await waitFor(() => document.querySelector('#certificate-import-privateKeyPem') !== null)
        const certificatePem = '-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----'
        const privateKeyPem = '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----'
        await setValue(document.querySelector('#certificate-import-name')!, 'Imported edge')
        await setValue(
            document.querySelector('#certificate-import-certificatePem')!,
            certificatePem,
        )
        await setValue(document.querySelector('#certificate-import-privateKeyPem')!, privateKeyPem)
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
        await waitFor(() => document.querySelector('[role=dialog]') === null)
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
        await click(lastButton('Request with ACME'))
        await waitFor(() => requestCertificateHandlerMock.mock.calls.length === 1)
        expect(requestCertificateHandlerMock).toHaveBeenCalledWith({
            data: {
                name: 'Staging edge',
                domains: ['edge.example.com', 'www.edge.example.com'],
                environment: 'staging',
                contactEmail: 'ops@example.com',
                acceptTerms: true,
            },
        })
        await waitForToast('success')
    })
})

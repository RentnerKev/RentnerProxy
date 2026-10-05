import { afterEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { CertificateSummary } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import type {
    RedirectHostActionResult,
    RedirectHostSummary,
} from '@/lib/Admin/RedirectHostManagement/Types/redirect-hosts.types.ts'
import { getRedirectHostFormDefaultValues } from '@/lib/Admin/RedirectHostManagement/redirectHostFormValues.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()
const { act, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { ToastProvider } = await import('@rentnerkev/toasts')
const createHost = mock(async (_input: unknown): Promise<RedirectHostActionResult> => ({
    success: true,
    message: 'admin.redirectHosts.messages.created',
    runtimeStatus: 'pending' as const,
}))
const updateHost = mock(async (_input: unknown) => ({
    success: true,
    message: 'admin.redirectHosts.messages.updated',
}))
const certificate: CertificateSummary = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54022',
    name: 'Existing TLS',
    domains: ['*.example.com'],
    source: 'acme',
    environment: 'staging',
    status: 'valid',
    operation: 'idle',
    issuedAt: new Date('2026-01-01'),
    expiresAt: new Date('2027-01-01'),
    issuer: 'Test CA',
    fingerprint: 'fixture',
    candidate: null,
    dnsCleanupPending: false,
    lastErrorCode: null,
    assignedHostCount: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
}
mock.module('@/features/Admin/RedirectHostManagement/middleware.ts', () => ({
    createRedirectHostHandler: createHost,
    updateRedirectHostHandler: updateHost,
    getAssignableRedirectCertificatesHandler: async () => [certificate],
    getRedirectHostsHandler: async () => [],
    getRedirectRuntimeStatusHandler: async () => ({
        available: true,
        running: true,
        activeRevision: 'sha256:active',
        desiredRevision: 'sha256:active',
        lastApplyAt: null,
        state: 'synced',
    }),
    applyRedirectConfigurationHandler: async () => ({ success: true }),
    deleteRedirectHostHandler: async () => ({ success: true }),
    disableRedirectHostHandler: async () => ({ success: true }),
    enableRedirectHostHandler: async () => ({ success: true }),
}))
mock.module('@/shared/Live/Hooks/useLiveInvalidation.ts', () => ({ default: () => undefined }))
const { default: useManagement } =
    await import('@/features/Admin/RedirectHostManagement/Hooks/useRedirectHostManagementLogic.ts')
const { default: RedirectHostFormModal } =
    await import('@/features/Admin/RedirectHostManagement/Components/RedirectHostFormModal/index.tsx')
const host: RedirectHostSummary = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54019',
    domains: ['old.example.com', 'old2.example.com'],
    destination: 'https://example.com/archive',
    statusCode: 308,
    preserveRequestUri: false,
    enabled: false,
    certificateId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
}
let root: Root | undefined
let client: InstanceType<typeof QueryClient> | undefined
let management: ReturnType<typeof useManagement> | undefined
function Harness({ permissions }: { permissions: readonly PermissionKey[] }) {
    const logic = useManagement({ permissions })
    useEffect(() => {
        management = logic
    }, [logic])
    return logic.state.duplicateSource ? (
        <RedirectHostFormModal
            open
            mode="duplicate"
            redirectHost={logic.state.duplicateSource}
            canAssignCertificates={logic.state.canAssignCertificates}
            canEnable={false}
            canDisable={false}
            onOpenChange={logic.handler.setDuplicateOpen}
            onSuccess={logic.handler.handleFormSuccess}
        />
    ) : (
        <span>Closed</span>
    )
}
async function render(element: ReactElement) {
    const container = document.createElement('div')
    document.body.append(container)
    client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    root = createRoot(container)
    await act(async () => {
        root?.render(
            withTestLanguage(
                <QueryClientProvider client={client!}>
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
                        {element}
                    </ToastProvider>
                </QueryClientProvider>,
            ),
        )
    })
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15))
    })
}
async function run(callback: () => void) {
    await act(async () => {
        callback()
        await Promise.resolve()
    })
}
async function waitFor(condition: () => boolean) {
    const deadline = Date.now() + 1500
    while (!condition() && Date.now() < deadline)
        // oxlint-disable-next-line no-await-in-loop -- Poll React updates sequentially until the assertion is ready.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    expect(condition()).toBeTrue()
}
async function enterDomain(value: string) {
    const input = document.querySelector<HTMLInputElement>('input[name="domains[0]"]')!
    await run(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            input,
            value,
        )
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
    })
}
afterEach(async () => {
    await act(async () => root?.unmount())
    client?.clear()
    document.body.innerHTML = ''
    root = undefined
    management = undefined
    createHost.mockClear()
    updateHost.mockClear()
})
describe('Redirect Host duplicate draft', () => {
    test('copies only editable values and creates independent domain arrays', () => {
        const source = { ...host, certificateId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54022' }
        const values = getRedirectHostFormDefaultValues('duplicate', source)
        expect(values).toEqual({
            domains: [''],
            destination: host.destination,
            statusCode: '308',
            preserveRequestUri: false,
            enabled: false,
            certificateId: source.certificateId,
        })
        values.domains.push('new.example.com')
        expect(source.domains).toEqual(['old.example.com', 'old2.example.com'])
        expect(getRedirectHostFormDefaultValues('edit', source).domains).not.toBe(source.domains)
    })
    test.each([
        [[], false],
        [[PERMISSIONS.REDIRECT_HOSTS_VIEW], false],
        [[PERMISSIONS.REDIRECT_HOSTS_CREATE], false],
        [[PERMISSIONS.REDIRECT_HOSTS_VIEW, PERMISSIONS.REDIRECT_HOSTS_UPDATE], false],
        [[PERMISSIONS.REDIRECT_HOSTS_VIEW, PERMISSIONS.REDIRECT_HOSTS_CREATE], true],
    ] as const)('guards opening duplicate with permissions %j', async (permissions, permitted) => {
        await render(<Harness permissions={permissions} />)
        expect(management?.state.canDuplicate(host)).toBe(permitted)
        expect(
            management?.state.canDuplicate({ ...host, certificateId: 'certificate-reference' }),
        ).toBe(permitted)
        await run(() => management?.handler.openDuplicate(host))
        expect(management?.state.duplicateSource).toEqual(permitted ? host : null)
        expect(createHost).not.toHaveBeenCalled()
        expect(updateHost).not.toHaveBeenCalled()
    })
    test('renders a blank domain draft, saves through create, and clears it on success', async () => {
        const before = structuredClone(host)
        await render(
            <Harness
                permissions={[PERMISSIONS.REDIRECT_HOSTS_VIEW, PERMISSIONS.REDIRECT_HOSTS_CREATE]}
            />,
        )
        await run(() => management?.handler.openDuplicate(host))
        expect(document.querySelectorAll('input[name^="domains["]')).toHaveLength(1)
        expect(document.querySelector<HTMLInputElement>('input[name="domains[0]"]')?.value).toBe('')
        expect(document.querySelector<HTMLInputElement>('input[name="destination"]')?.value).toBe(
            host.destination,
        )
        expect(
            document.querySelector<HTMLInputElement>('input[name="enabled"]')?.disabled,
        ).toBeFalse()
        expect(createHost).not.toHaveBeenCalled()
        await run(() =>
            document
                .querySelector('form')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        )
        expect(createHost).not.toHaveBeenCalled()
        await enterDomain('new.example.com')
        await run(() =>
            document
                .querySelector('form')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        )
        await waitFor(() => createHost.mock.calls.length === 1)
        expect(createHost.mock.calls[0]?.[0]).toEqual({
            data: {
                domains: ['new.example.com'],
                destination: host.destination,
                statusCode: 308,
                preserveRequestUri: false,
                enabled: false,
                certificateId: null,
            },
        })
        expect(updateHost).not.toHaveBeenCalled()
        await waitFor(() => management?.state.duplicateSource === null)
        expect(host).toEqual(before)
    })
    test('retains the existing certificate reference and reports pending create success', async () => {
        const source = { ...host, certificateId: certificate.id }
        const before = structuredClone(source)
        await render(
            <Harness
                permissions={[PERMISSIONS.REDIRECT_HOSTS_VIEW, PERMISSIONS.REDIRECT_HOSTS_CREATE]}
            />,
        )
        await run(() => management?.handler.openDuplicate(source))
        await waitFor(
            () =>
                document.querySelector<HTMLInputElement>('[name="certificateId"]')?.value ===
                certificate.id,
        )
        expect(document.querySelector<HTMLInputElement>('input[name="domains[0]"]')?.value).toBe('')
        expect(createHost).not.toHaveBeenCalled()
        await enterDomain('new.example.com')
        await run(() =>
            document
                .querySelector('form')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        )
        await waitFor(() => management?.state.duplicateSource === null)
        expect(createHost).toHaveBeenCalledTimes(1)
        expect(createHost.mock.calls[0]?.[0]).toEqual({
            data: {
                domains: ['new.example.com'],
                destination: source.destination,
                statusCode: 308,
                preserveRequestUri: false,
                enabled: false,
                certificateId: certificate.id,
            },
        })
        expect(updateHost).not.toHaveBeenCalled()
        expect(source).toEqual(before)
        await waitFor(
            () =>
                document
                    .querySelector('.rentnerproxy-toast-warning')
                    ?.textContent?.includes('Saved changes are waiting to be applied.') === true,
        )
    })
    test.each([
        'admin.certificates.errors.domain_mismatch',
        'admin.redirectHosts.errors.domain_conflict',
    ])('keeps the duplicate draft after backend validation %s', async (message) => {
        const source = { ...host, certificateId: certificate.id }
        const before = structuredClone(source)
        createHost.mockImplementationOnce(async () => ({ success: false, message }))
        await render(
            <Harness
                permissions={[PERMISSIONS.REDIRECT_HOSTS_VIEW, PERMISSIONS.REDIRECT_HOSTS_CREATE]}
            />,
        )
        await run(() => management?.handler.openDuplicate(source))
        await enterDomain('conflict.example.com')
        await run(() =>
            document
                .querySelector('form')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        )
        await waitFor(() => document.querySelector('.rentnerproxy-toast-error') !== null)
        expect(createHost).toHaveBeenCalledTimes(1)
        expect(createHost.mock.calls[0]?.[0]).toEqual({
            data: {
                domains: ['conflict.example.com'],
                destination: source.destination,
                statusCode: 308,
                preserveRequestUri: false,
                enabled: false,
                certificateId: certificate.id,
            },
        })
        expect(updateHost).not.toHaveBeenCalled()
        expect(management?.state.duplicateSource).toBe(source)
        expect(document.querySelector<HTMLInputElement>('input[name="domains[0]"]')?.value).toBe(
            'conflict.example.com',
        )
        expect(document.querySelector<HTMLInputElement>('input[name="destination"]')?.value).toBe(
            source.destination,
        )
        expect(document.querySelector<HTMLInputElement>('[name="certificateId"]')?.value).toBe(
            certificate.id,
        )
        expect(
            document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
        ).toBeFalse()
        expect(source).toEqual(before)
    })
    test('cancels without writing and opening create/edit clears duplicate source', async () => {
        await render(
            <Harness
                permissions={[PERMISSIONS.REDIRECT_HOSTS_VIEW, PERMISSIONS.REDIRECT_HOSTS_CREATE]}
            />,
        )
        await run(() => management?.handler.openDuplicate(host))
        await enterDomain('cancelled.example.com')
        const cancel = [...document.querySelectorAll('button')].find(
            (button) => button.textContent?.trim() === 'Cancel',
        )!
        await run(() => cancel.click())
        expect(management?.state.duplicateSource).toBeNull()
        await run(() => management?.handler.openDuplicate(host))
        expect(document.querySelector<HTMLInputElement>('input[name="domains[0]"]')?.value).toBe('')
        await run(() => management?.handler.openCreate())
        expect(management?.state.duplicateSource).toBeNull()
        expect(management?.state.showCreate).toBeTrue()
        await run(() => management?.handler.openDuplicate(host))
        await run(() => management?.handler.openEditor(host))
        expect(management?.state.duplicateSource).toBeNull()
        expect(management?.state.selected).toBe(host)
        expect(createHost).not.toHaveBeenCalled()
        expect(updateHost).not.toHaveBeenCalled()
    })
})

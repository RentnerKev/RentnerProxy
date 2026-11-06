import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import type {
    CrowdSecConfiguration,
    CrowdSecDashboard,
} from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register({ settings: { device: { prefersReducedMotion: 'reduce' } } })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act, Activity } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { ToastProvider, toast } = await import('@rentnerkev/toasts')

function disabledConfiguration(): CrowdSecConfiguration {
    return {
        mode: 'disabled',
        communityEnabled: false,
        externalApiUrl: null,
        hasApiKey: false,
        synchronized: true,
        runtime: {
            mode: 'disabled',
            state: 'disabled',
            credentialConfigured: false,
            enforcementActive: false,
            managedEngine: 'stopped',
            communityEnabled: false,
            communityState: 'disabled',
            consoleState: 'not_enrolled',
            failureBehavior: 'fail_open',
            clientIpSource: 'caddy',
        },
    }
}

let configuration = disabledConfiguration()
let configurationFetchFails = false
let loseSaveResponse = false
let saveFailure = false
let saveGate: Promise<void> | null = null
let releaseSave: (() => void) | null = null
const getConfigurationMock = mock(async () => {
    if (configurationFetchFails) throw new Error('connection interrupted')
    return configuration
})
let dashboardSnapshot: CrowdSecDashboard = {
    collectedAt: 1_800_000_000,
    metrics: null,
    decisions: null,
}
const getDashboardMock = mock(async () => dashboardSnapshot)
const testConnectionMock = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.crowdSec.messages.connectionValid',
}))
const enrollConsoleMock = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.crowdSec.messages.enrollmentPending',
}))
const updateConfigurationMock = mock(
    async ({
        data,
    }: {
        readonly data: {
            mode: 'disabled' | 'managed' | 'external'
            communityEnabled?: boolean
            apiUrl?: string
            apiKey?: string
        }
    }) => {
        if (saveGate) await saveGate
        if (saveFailure)
            return {
                success: false as const,
                message: 'admin.crowdSec.errors.configurationConflict',
            }
        configuration = {
            ...configuration,
            mode: data.mode,
            communityEnabled: data.communityEnabled ?? configuration.communityEnabled,
            externalApiUrl: data.apiUrl ?? configuration.externalApiUrl,
            hasApiKey: data.mode === 'external' || configuration.hasApiKey,
            synchronized: false,
        }
        if (loseSaveResponse) throw new Error('connection interrupted')
        return {
            success: true as const,
            message: 'admin.crowdSec.messages.savedPending',
            runtimeStatus: 'pending' as const,
        }
    },
)

mock.module('@/features/Admin/CrowdSec/middleware.ts', () => ({
    getCrowdSecConfigurationHandler: getConfigurationMock,
    getCrowdSecDashboardHandler: getDashboardMock,
    enrollCrowdSecConsoleHandler: enrollConsoleMock,
    testCrowdSecConnectionHandler: testConnectionMock,
    updateCrowdSecConfigurationHandler: updateConfigurationMock,
}))

const { default: CrowdSecPage } = await import('@/features/Admin/CrowdSec/index.tsx')

let activeRoot: Root | null = null
let activeQueryClient: InstanceType<typeof QueryClient> | null = null

async function renderPage(permissions: readonly string[]): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeQueryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    activeRoot = createRoot(container)
    await renderPermissions(permissions)
    await waitFor(() => container.textContent?.includes('Protection source') === true)
    return container
}

async function renderPermissions(
    permissions: readonly string[],
    visible = true,
    identity = 0,
): Promise<void> {
    await act(async () => {
        activeRoot?.render(
            withTestLanguage(
                <TooltipProvider>
                    <ToastProvider {...TOAST_PROVIDER_PROPS} locale="en">
                        <QueryClientProvider client={activeQueryClient!}>
                            <Activity mode={visible ? 'visible' : 'hidden'} key={identity}>
                                <CrowdSecPage permissions={permissions} />
                            </Activity>
                        </QueryClientProvider>
                    </ToastProvider>
                </TooltipProvider>,
            ),
        )
        await Promise.resolve()
    })
}

async function click(element: Element): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
        await Promise.resolve()
    })
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await Promise.resolve()
    })
}

async function waitFor(condition: () => boolean, timeoutMs = 1_500): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!condition()) {
        if (Date.now() >= deadline) throw new Error('timed out waiting for CrowdSec UI state')
        // oxlint-disable-next-line eslint/no-await-in-loop -- Polling must observe each rendered state in order.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    }
}

async function refreshConfiguration(): Promise<void> {
    await act(async () => {
        await activeQueryClient?.invalidateQueries({ queryKey: ['crowdsec', 'configuration'] })
    })
}

function progressValue(): number {
    const progress = document.querySelector<HTMLProgressElement>('progress')
    if (!progress) throw new Error('CrowdSec progress bar not found')
    return progress.value
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
    const match = [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
        candidate.textContent?.includes(label),
    )
    if (!match) throw new Error(`button not found: ${label}`)
    return match
}

beforeEach(() => {
    configuration = disabledConfiguration()
    dashboardSnapshot = { collectedAt: 1_800_000_000, metrics: null, decisions: null }
    configurationFetchFails = false
    loseSaveResponse = false
    saveFailure = false
    saveGate = null
    releaseSave = null
    getConfigurationMock.mockClear()
    getDashboardMock.mockClear()
    testConnectionMock.mockClear()
    enrollConsoleMock.mockClear()
    updateConfigurationMock.mockClear()
})

afterEach(async () => {
    await act(async () => activeRoot?.unmount())
    activeRoot = null
    activeQueryClient?.clear()
    activeQueryClient = null
    toast.dismissAll()
    document.body.replaceChildren()
})

describe('CrowdSec management UI', () => {
    test('keeps protection telemetry off the CrowdSec configuration page', async () => {
        configuration = {
            ...disabledConfiguration(),
            mode: 'managed',
            runtime: {
                ...disabledConfiguration().runtime!,
                mode: 'managed',
                state: 'connected',
                enforcementActive: true,
                managedEngine: 'ready',
            },
        }
        dashboardSnapshot = {
            collectedAt: 1_800_000_000,
            metrics: {
                blockedRequests: 12,
                activeDecisions: 3,
                blockedByOrigin: [],
                decisionsByOrigin: [],
            },
            decisions: {
                total: 1,
                filteredTotal: 1,
                offset: 0,
                limit: 15,
                availableOrigins: ['crowdsec'],
                entries: [
                    {
                        id: 1,
                        scope: 'Ip',
                        value: '203.0.113.4',
                        origin: 'crowdsec',
                        scenario: 'http-bf',
                        duration: '2h',
                        countryCode: null,
                    },
                ],
            },
        }
        const container = await renderPage([PERMISSIONS.CROWDSEC_VIEW])
        expect(getDashboardMock).not.toHaveBeenCalled()
        expect(container.textContent).not.toContain('203.0.113.4')
        expect(container.textContent).not.toContain('Blocked requests by origin')
    })

    test('keeps community opt-in within managed mode and enrolls Console separately', async () => {
        configuration = {
            ...disabledConfiguration(),
            mode: 'managed',
            runtime: {
                ...disabledConfiguration().runtime!,
                mode: 'managed',
                state: 'connected',
                enforcementActive: true,
                managedEngine: 'ready',
            },
        }
        const container = await renderPage([PERMISSIONS.CROWDSEC_VIEW, PERMISSIONS.CROWDSEC_UPDATE])
        const checkbox = container.querySelector<HTMLInputElement>('#crowdsec-community-enabled')!
        expect(checkbox.checked).toBeFalse()
        expect(container.querySelector('[name="crowdsec-enrollment-key"]')).toBeNull()

        await click(checkbox)
        expect(checkbox.checked).toBeTrue()
        await click(button(container, 'Save and apply'))
        await waitFor(() => updateConfigurationMock.mock.calls.length === 1)
        expect(updateConfigurationMock.mock.calls[0]?.[0]).toEqual({
            data: { mode: 'managed', communityEnabled: true },
        })

        configuration = {
            ...configuration,
            synchronized: true,
            runtime: {
                ...configuration.runtime!,
                communityEnabled: true,
                communityState: 'connected',
            },
        }
        await refreshConfiguration()
        await waitFor(() => container.querySelector('[name="crowdsec-enrollment-key"]') !== null)
        const keyInput = container.querySelector<HTMLInputElement>(
            '[name="crowdsec-enrollment-key"]',
        )!
        expect(keyInput).not.toBeNull()
        const syntheticEnrollmentKey = 'a'.repeat(16)
        await setInputValue(keyInput, syntheticEnrollmentKey)
        await click(button(container, 'Connect Console'))
        await waitFor(() => enrollConsoleMock.mock.calls.length === 1)
        expect(enrollConsoleMock.mock.calls[0]?.[0]).toEqual({
            data: { enrollmentKey: syntheticEnrollmentKey },
        })
        await waitFor(() => keyInput.value === '')
    })

    test('keeps configuration read-only for a viewer', async () => {
        const container = await renderPage([PERMISSIONS.CROWDSEC_VIEW])

        expect(container.textContent).toContain('Default after upgrading')
        expect(container.textContent).not.toContain('Local API health')
        expect(container.textContent).not.toContain('Managed engine')
        expect(container.textContent).toContain('Inactive')
        expect(container.querySelector('[data-state="disabled"]')).not.toBeNull()
        expect(
            container.querySelector<HTMLInputElement>('#crowdsec-mode-managed')?.disabled,
        ).toBeTrue()
        expect(
            container.querySelector<HTMLInputElement>('#crowdsec-mode-external')?.disabled,
        ).toBeTrue()
        expect(button(container, 'Save and apply').disabled).toBeTrue()
        expect(container.querySelector('[name="crowdsec-api-key"]')).toBeNull()
    })

    test('distinguishes the desired mode from the active mode while synchronization is pending', async () => {
        configuration = {
            ...disabledConfiguration(),
            synchronized: false,
            runtime: {
                ...disabledConfiguration().runtime!,
                mode: 'managed',
                state: 'connected',
                enforcementActive: true,
                managedEngine: 'ready',
            },
        }
        const container = await renderPage([PERMISSIONS.CROWDSEC_VIEW])
        const statusPanel = container.querySelector('[data-state="connected"]')?.closest('section')

        expect(statusPanel?.textContent).toContain('Active mode')
        expect(statusPanel?.textContent).toContain('Managed by RentnerProxy')
        expect(statusPanel?.textContent).toContain('Previous working mode remains active')
        expect(statusPanel?.textContent).toContain('Active')
    })

    test('does not claim protection is inactive when runtime health is unavailable', async () => {
        configuration = { ...disabledConfiguration(), runtime: null, synchronized: false }
        const container = await renderPage([PERMISSIONS.CROWDSEC_VIEW])
        const statusPanel = container
            .querySelector('[data-state="unavailable"]')
            ?.closest('section')

        expect(statusPanel?.textContent).toContain('Controller unavailable')
        expect(statusPanel?.textContent).not.toContain('Inactive')
        expect(statusPanel?.textContent).toContain('active protection state cannot be confirmed')
    })

    test('tests and saves an external provider without reading its stored key', async () => {
        configuration = {
            ...disabledConfiguration(),
            externalApiUrl: 'https://old-crowdsec.example.test/',
            hasApiKey: true,
        }
        const container = await renderPage([PERMISSIONS.CROWDSEC_VIEW, PERMISSIONS.CROWDSEC_UPDATE])

        await click(container.querySelector<HTMLInputElement>('#crowdsec-mode-external')!)
        const apiUrl = container.querySelector<HTMLInputElement>('[name="crowdsec-api-url"]')
        const apiKey = container.querySelector<HTMLInputElement>('[name="crowdsec-api-key"]')
        expect(apiUrl?.closest('.grid.items-start')).toBe(apiKey?.closest('.grid.items-start'))
        expect(button(container, 'Test connection').parentElement).toBe(
            button(container, 'Save and apply').parentElement,
        )
        expect(apiUrl?.value).toBe('https://old-crowdsec.example.test/')
        expect(apiKey?.value).toBe('')
        expect(apiKey?.placeholder).toContain('Credential stored')
        expect(apiKey?.getAttribute('aria-describedby')).toContain('crowdsec-api-key-hint')

        await setInputValue(apiUrl!, 'https://new-crowdsec.example.test:8080/')
        await setInputValue(apiKey!, 'replacement-bouncer-key')
        await click(button(container, 'Test connection'))
        await waitFor(() => testConnectionMock.mock.calls.length === 1)
        expect(testConnectionMock.mock.calls[0]?.[0]).toEqual({
            data: {
                apiUrl: 'https://new-crowdsec.example.test:8080/',
                apiKey: 'replacement-bouncer-key',
            },
        })

        await click(button(container, 'Save and apply'))
        await waitFor(() => updateConfigurationMock.mock.calls.length === 1)
        expect(updateConfigurationMock.mock.calls[0]?.[0]).toEqual({
            data: {
                mode: 'external',
                apiUrl: 'https://new-crowdsec.example.test:8080/',
                apiKey: 'replacement-bouncer-key',
            },
        })
        await waitFor(
            () =>
                container.querySelector<HTMLInputElement>('[name="crowdsec-api-key"]')?.value ===
                '',
        )
    })

    test('shows confirmed managed activation milestones and keeps the page during a failed refresh', async () => {
        saveGate = new Promise<void>((resolve) => {
            releaseSave = resolve
        })
        const container = await renderPage([PERMISSIONS.CROWDSEC_VIEW, PERMISSIONS.CROWDSEC_UPDATE])

        await click(container.querySelector<HTMLInputElement>('#crowdsec-mode-managed')!)
        await click(button(container, 'Save and apply'))

        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
            'Enable managed CrowdSec',
        )
        expect(progressValue()).toBe(0)

        await act(async () => {
            releaseSave?.()
            await saveGate
        })
        await waitFor(() => progressValue() === 30)

        configurationFetchFails = true
        await refreshConfiguration()
        expect(container.textContent).not.toContain('CrowdSec configuration unavailable')
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()

        configurationFetchFails = false
        configuration = {
            ...configuration,
            runtime: { ...configuration.runtime!, managedEngine: 'starting' },
        }
        await refreshConfiguration()
        await waitFor(() => progressValue() === 50)

        configuration = {
            ...configuration,
            runtime: { ...configuration.runtime!, managedEngine: 'ready' },
        }
        await refreshConfiguration()
        await waitFor(() => progressValue() === 70)

        configuration = {
            ...configuration,
            synchronized: true,
            runtime: {
                ...configuration.runtime!,
                mode: 'managed',
                state: 'connected',
                enforcementActive: true,
            },
        }
        await refreshConfiguration()
        await waitFor(() => progressValue() === 100)
        await waitFor(() => document.querySelector('.rentnerproxy-toast-success') !== null)
        expect(document.querySelector('.rentnerproxy-toast-success')?.textContent).toContain(
            'Success',
        )
        expect(document.querySelector('.rentnerproxy-toast-success')?.textContent).toContain(
            'Managed CrowdSec is active',
        )
        expect(document.querySelector('[role="dialog"] output')).toBeNull()
        await refreshConfiguration()
        expect(document.querySelectorAll('.rentnerproxy-toast-success')).toHaveLength(1)
    })

    test('checks the disabled runtime after the save response is lost', async () => {
        configuration = {
            ...disabledConfiguration(),
            mode: 'managed',
            runtime: {
                ...disabledConfiguration().runtime!,
                mode: 'managed',
                state: 'connected',
                enforcementActive: true,
                managedEngine: 'ready',
            },
        }
        loseSaveResponse = true
        const container = await renderPage([PERMISSIONS.CROWDSEC_VIEW, PERMISSIONS.CROWDSEC_UPDATE])

        await click(container.querySelector<HTMLInputElement>('#crowdsec-mode-disabled')!)
        await click(button(container, 'Save and apply'))
        await waitFor(
            () =>
                document.querySelector('[role="dialog"]')?.textContent?.includes('interrupted') ===
                true,
        )
        expect(document.querySelector('.rentnerproxy-toast-warning')?.textContent).toContain(
            'Please note',
        )
        expect(document.querySelector('.rentnerproxy-toast-warning')?.textContent).toContain(
            'interrupted',
        )
        expect(document.querySelector('.rentnerproxy-toast-error')).toBeNull()
        expect(document.querySelector('.rentnerproxy-toast-success')).toBeNull()
        await refreshConfiguration()
        await waitFor(() => progressValue() === 30)
        expect(document.querySelectorAll('.rentnerproxy-toast-warning')).toHaveLength(1)

        configuration = {
            ...configuration,
            runtime: {
                ...configuration.runtime!,
                mode: 'disabled',
                state: 'disabled',
                enforcementActive: false,
            },
        }
        await refreshConfiguration()
        await waitFor(() => progressValue() === 75)

        configuration = {
            ...configuration,
            synchronized: true,
            runtime: { ...configuration.runtime!, managedEngine: 'stopped' },
        }
        await refreshConfiguration()
        await waitFor(() => progressValue() === 100)
        await waitFor(() => document.querySelector('.rentnerproxy-toast-success') !== null)
        expect(document.querySelector('.rentnerproxy-toast-success')?.textContent).toContain(
            'Success',
        )
        expect(document.querySelector('.rentnerproxy-toast-success')?.textContent).toContain(
            'protection is disabled',
        )
        expect(document.querySelector('[role="dialog"] output')).toBeNull()
        expect(container.textContent).not.toContain('CrowdSec configuration unavailable')
    })

    test('shows a rejected mode change without reporting completion', async () => {
        saveFailure = true
        const container = await renderPage([PERMISSIONS.CROWDSEC_VIEW, PERMISSIONS.CROWDSEC_UPDATE])

        await click(container.querySelector<HTMLInputElement>('#crowdsec-mode-managed')!)
        await click(button(container, 'Save and apply'))
        await waitFor(
            () =>
                document
                    .querySelector('.rentnerproxy-toast-error')
                    ?.textContent?.includes('changed in another session') === true,
        )

        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
            'Action failed',
        )
        expect(document.body.textContent?.split('changed in another session')).toHaveLength(2)
        expect(document.querySelector('[role="dialog"] output')).toBeNull()
        expect(
            document.querySelector('.rentnerproxy-toast-error [data-testid="toast-progress"]'),
        ).toBeNull()
        expect(document.querySelector('.rentnerproxy-toast-success')).toBeNull()
        await refreshConfiguration()
        expect(document.querySelectorAll('.rentnerproxy-toast-error')).toHaveLength(1)
        expect(progressValue()).toBe(0)
        expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
            'Managed CrowdSec is active',
        )
        expect(configuration.mode).toBe('disabled')
    })

    test.each(['rejected', 'lost response', 'accepted'] as const)(
        'suppresses late %s feedback after update permission is lost and restored',
        async (outcome) => {
            saveFailure = outcome === 'rejected'
            loseSaveResponse = outcome === 'lost response'
            saveGate = new Promise<void>((resolve) => {
                releaseSave = resolve
            })
            const container = await renderPage([
                PERMISSIONS.CROWDSEC_VIEW,
                PERMISSIONS.CROWDSEC_UPDATE,
            ])
            await click(container.querySelector<HTMLInputElement>('#crowdsec-mode-managed')!)
            await click(button(container, 'Save and apply'))
            await renderPermissions([PERMISSIONS.CROWDSEC_VIEW])
            await renderPermissions([PERMISSIONS.CROWDSEC_VIEW, PERMISSIONS.CROWDSEC_UPDATE])
            await act(async () => {
                releaseSave?.()
                await saveGate
                await new Promise((resolve) => setTimeout(resolve, 20))
            })
            if (outcome === 'accepted') {
                await waitFor(
                    () =>
                        activeQueryClient?.getQueryData<CrowdSecConfiguration>([
                            'crowdsec',
                            'configuration',
                        ])?.mode === 'managed',
                )
            }
            expect(document.querySelector('.rentnerproxy-toast')).toBeNull()
            expect(document.querySelector('progress')).toBeNull()
        },
    )

    test.each(['hidden', 'resumed'] as const)(
        'reconciles an external save for the same identity when its Activity is %s',
        async (settleWhile) => {
            const permissions = [PERMISSIONS.CROWDSEC_VIEW, PERMISSIONS.CROWDSEC_UPDATE]
            const container = await renderPage(permissions)
            await click(container.querySelector<HTMLInputElement>('#crowdsec-mode-external')!)
            await setInputValue(
                container.querySelector<HTMLInputElement>('[name="crowdsec-api-url"]')!,
                'https://crowdsec.example.test/',
            )
            await setInputValue(
                container.querySelector<HTMLInputElement>('[name="crowdsec-api-key"]')!,
                'test-replacement-bouncer-key',
            )
            saveGate = new Promise<void>((resolve) => {
                releaseSave = resolve
            })
            await click(button(container, 'Save and apply'))
            await renderPermissions(permissions, false)
            if (settleWhile === 'resumed') await renderPermissions(permissions)
            await act(async () => {
                releaseSave?.()
                await saveGate
                await new Promise((resolve) => setTimeout(resolve, 20))
            })
            if (settleWhile === 'hidden') {
                expect(document.querySelector('.rentnerproxy-toast')).toBeNull()
                await renderPermissions(permissions)
            }
            await waitFor(
                () =>
                    container.querySelector<HTMLInputElement>('[name="crowdsec-api-key"]')
                        ?.value === '',
            )
            expect(button(container, 'Save and apply').disabled).toBe(true)
            expect(
                activeQueryClient?.getQueryData<CrowdSecConfiguration>([
                    'crowdsec',
                    'configuration',
                ])?.mode,
            ).toBe('external')
        },
    )

    test('refreshes a replacement identity cache without old save feedback or draft changes', async () => {
        const permissions = [PERMISSIONS.CROWDSEC_VIEW, PERMISSIONS.CROWDSEC_UPDATE]
        const container = await renderPage(permissions)
        await click(container.querySelector<HTMLInputElement>('#crowdsec-mode-managed')!)
        saveGate = new Promise<void>((resolve) => {
            releaseSave = resolve
        })
        await click(button(container, 'Save and apply'))
        await renderPermissions(permissions, true, 1)
        await click(container.querySelector<HTMLInputElement>('#crowdsec-mode-external')!)
        await setInputValue(
            container.querySelector<HTMLInputElement>('[name="crowdsec-api-key"]')!,
            'replacement-draft',
        )
        await act(async () => {
            releaseSave?.()
            await saveGate
            await new Promise((resolve) => setTimeout(resolve, 20))
        })
        await waitFor(
            () =>
                activeQueryClient?.getQueryData<CrowdSecConfiguration>([
                    'crowdsec',
                    'configuration',
                ])?.mode === 'managed',
        )
        expect(document.querySelector('.rentnerproxy-toast')).toBeNull()
        expect(container.querySelector<HTMLInputElement>('[name="crowdsec-api-key"]')?.value).toBe(
            'replacement-draft',
        )
        expect(document.querySelector('progress')).toBeNull()
    })

    test('shows a persistent rejected-save toast only when its original Activity resumes', async () => {
        const permissions = [PERMISSIONS.CROWDSEC_VIEW, PERMISSIONS.CROWDSEC_UPDATE]
        const container = await renderPage(permissions)
        saveFailure = true
        saveGate = new Promise<void>((resolve) => {
            releaseSave = resolve
        })
        await click(container.querySelector<HTMLInputElement>('#crowdsec-mode-managed')!)
        await click(button(container, 'Save and apply'))
        await renderPermissions(permissions, false)
        await act(async () => {
            releaseSave?.()
            await saveGate
            await new Promise((resolve) => setTimeout(resolve, 20))
        })
        expect(document.querySelector('.rentnerproxy-toast')).toBeNull()
        await renderPermissions(permissions)
        await waitFor(() => document.querySelector('.rentnerproxy-toast-error') !== null)
        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
            'changed in another session',
        )
        expect(
            document.querySelector('.rentnerproxy-toast-error [data-testid="toast-progress"]'),
        ).toBeNull()
        expect(document.querySelector('[role="dialog"] output')).toBeNull()
    })

    test.each(['managed', 'external'] as const)(
        'reconciles a lost %s save response while hidden and reports it once on resume',
        async (mode) => {
            const permissions = [PERMISSIONS.CROWDSEC_VIEW, PERMISSIONS.CROWDSEC_UPDATE]
            const container = await renderPage(permissions)
            loseSaveResponse = true
            saveGate = new Promise<void>((resolve) => {
                releaseSave = resolve
            })
            await click(container.querySelector<HTMLInputElement>(`#crowdsec-mode-${mode}`)!)
            if (mode === 'external') {
                await setInputValue(
                    container.querySelector<HTMLInputElement>('[name="crowdsec-api-url"]')!,
                    'https://crowdsec.example.test/',
                )
                await setInputValue(
                    container.querySelector<HTMLInputElement>('[name="crowdsec-api-key"]')!,
                    'test-replacement-bouncer-key',
                )
            }
            await click(button(container, 'Save and apply'))
            await renderPermissions(permissions, false)
            await act(async () => {
                releaseSave?.()
                await saveGate
                await new Promise((resolve) => setTimeout(resolve, 20))
            })
            expect(document.querySelector('.rentnerproxy-toast')).toBeNull()
            await renderPermissions(permissions)
            const kind = mode === 'managed' ? 'warning' : 'error'
            await waitFor(() => document.querySelector(`.rentnerproxy-toast-${kind}`) !== null)
            expect(document.querySelector(`.rentnerproxy-toast-${kind}`)?.textContent).toContain(
                mode === 'managed' ? 'interrupted' : 'could not be saved',
            )
            if (mode === 'managed') {
                expect(document.querySelector('[role="dialog"] output')?.textContent).toContain(
                    'interrupted',
                )
            }
            await renderPermissions(permissions)
            expect(document.querySelectorAll('.rentnerproxy-toast')).toHaveLength(1)
        },
    )
})

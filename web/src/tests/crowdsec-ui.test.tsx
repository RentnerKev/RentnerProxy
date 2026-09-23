import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import { PERMISSIONS } from '../config/permissions.config'
import { TOAST_PROVIDER_PROPS } from '../config/toast.config'
import type { CrowdSecConfiguration } from '../shared/Types/crowdsec.types'
import disableMotionAnimations from './Helpers/disableMotionAnimations'
import withTestLanguage from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { ToastProvider } = await import('@rentnerkev/toasts')
const { toast } = await import('@rentnerkev/toasts/toast')

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

mock.module('../features/Admin/CrowdSec/server', () => ({
    getCrowdSecConfigurationHandler: getConfigurationMock,
    enrollCrowdSecConsoleHandler: enrollConsoleMock,
    testCrowdSecConnectionHandler: testConnectionMock,
    updateCrowdSecConfigurationHandler: updateConfigurationMock,
}))

const { default: CrowdSecPage } = await import('../features/Admin/CrowdSec')

let activeRoot: Root | null = null
let activeQueryClient: InstanceType<typeof QueryClient> | null = null

async function renderPage(permissions: readonly string[]): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeQueryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    activeRoot = createRoot(container)
    await act(async () => {
        activeRoot?.render(
            withTestLanguage(
                <TooltipProvider>
                    <ToastProvider {...TOAST_PROVIDER_PROPS} locale="en">
                        <QueryClientProvider client={activeQueryClient!}>
                            <CrowdSecPage permissions={permissions} />
                        </QueryClientProvider>
                    </ToastProvider>
                </TooltipProvider>,
            ),
        )
        await Promise.resolve()
    })
    await waitFor(() => container.textContent?.includes('Protection source') === true)
    return container
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
    configurationFetchFails = false
    loseSaveResponse = false
    saveFailure = false
    saveGate = null
    releaseSave = null
    getConfigurationMock.mockClear()
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
        await setInputValue(keyInput, '0123456789abcdef')
        await click(button(container, 'Connect Console'))
        await waitFor(() => enrollConsoleMock.mock.calls.length === 1)
        expect(enrollConsoleMock.mock.calls[0]?.[0]).toEqual({
            data: { enrollmentKey: '0123456789abcdef' },
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

        releaseSave?.()
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
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
            'Managed CrowdSec is active',
        )
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
        await refreshConfiguration()
        await waitFor(() => progressValue() === 30)

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
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
            'protection is disabled',
        )
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
                    .querySelector('[role="dialog"]')
                    ?.textContent?.includes('changed in another session') === true,
        )

        expect(progressValue()).toBe(0)
        expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
            'Managed CrowdSec is active',
        )
        expect(configuration.mode).toBe('disabled')
    })
})

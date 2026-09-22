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
        externalApiUrl: null,
        hasApiKey: false,
        synchronized: true,
        runtime: {
            mode: 'disabled',
            state: 'disabled',
            credentialConfigured: false,
            enforcementActive: false,
            managedEngine: 'stopped',
            failureBehavior: 'fail_open',
            clientIpSource: 'caddy',
        },
    }
}

let configuration = disabledConfiguration()
const getConfigurationMock = mock(async () => configuration)
const testConnectionMock = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.crowdSec.messages.connectionValid',
}))
const updateConfigurationMock = mock(
    async ({
        data,
    }: {
        readonly data: {
            mode: 'disabled' | 'managed' | 'external'
            apiUrl?: string
            apiKey?: string
        }
    }) => {
        configuration = {
            ...configuration,
            mode: data.mode,
            externalApiUrl: data.apiUrl ?? configuration.externalApiUrl,
            hasApiKey: data.mode === 'external' || configuration.hasApiKey,
            synchronized: false,
        }
        return {
            success: true as const,
            message: 'admin.crowdSec.messages.savedPending',
            runtimeStatus: 'pending' as const,
        }
    },
)

mock.module('../features/Admin/CrowdSec/server', () => ({
    getCrowdSecConfigurationHandler: getConfigurationMock,
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

function button(container: HTMLElement, label: string): HTMLButtonElement {
    const match = [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
        candidate.textContent?.includes(label),
    )
    if (!match) throw new Error(`button not found: ${label}`)
    return match
}

beforeEach(() => {
    configuration = disabledConfiguration()
    getConfigurationMock.mockClear()
    testConnectionMock.mockClear()
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
    test('keeps configuration read-only for a viewer', async () => {
        const container = await renderPage([PERMISSIONS.CROWDSEC_VIEW])

        expect(container.textContent).toContain('Default after upgrading')
        expect(container.textContent).toContain('Local API health')
        expect(container.textContent).toContain('Managed engine')
        expect(container.textContent).toContain('Inactive')
        expect(container.textContent).toContain('Stopped')
        expect(
            container.querySelector<HTMLInputElement>('#crowdsec-mode-managed')?.disabled,
        ).toBeTrue()
        expect(
            container.querySelector<HTMLInputElement>('#crowdsec-mode-external')?.disabled,
        ).toBeTrue()
        expect(button(container, 'Save and apply').disabled).toBeTrue()
        expect(container.querySelector('[name="crowdsec-api-key"]')).toBeNull()
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
})

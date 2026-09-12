import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import { PERMISSIONS } from '../config/permissions.config'
import type {
    ProxyAccessLogsQuery,
    ProxyAccessLogsResult,
} from '../shared/Types/proxy-access-logs.types'
import withTestLanguage from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('../shared/Tooltip')

const firstEntry = {
    timestamp: '2026-09-12T12:00:00.000Z',
    host: 'app.example.com',
    method: 'GET',
    path: '/dashboard',
    status: 200,
    durationMs: 12,
    clientIp: '192.0.2.10',
    upstream: '127.0.0.1:8080',
    bytes: 2048,
    protocol: 'HTTP/2',
} as const

const secondEntry = {
    ...firstEntry,
    timestamp: '2026-09-12T11:00:00.000Z',
    path: '/older',
    status: 404,
} as const

const getProxyAccessLogsHandlerMock = mock(
    async ({ data }: { readonly data: ProxyAccessLogsQuery }): Promise<ProxyAccessLogsResult> => ({
        entries: data.offset === 0 ? [firstEntry] : [secondEntry],
        limit: data.limit ?? 100,
        offset: data.offset ?? 0,
        total: 101,
        hasMore: (data.offset ?? 0) === 0,
        truncated: false,
    }),
)

mock.module('../features/Admin/ProxyAccessLogs/server', () => ({
    getProxyAccessLogsHandler: getProxyAccessLogsHandlerMock,
}))

const { default: ProxyAccessLogsPage } = await import('../features/Admin/ProxyAccessLogs')

let activeRoot: Root | null = null
let activeQueryClient: InstanceType<typeof QueryClient> | null = null

async function renderPage(
    permissions: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][],
): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeQueryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    activeRoot = createRoot(container)
    await act(async () => {
        activeRoot?.render(
            withTestLanguage(
                <QueryClientProvider client={activeQueryClient!}>
                    <TooltipProvider>
                        <ProxyAccessLogsPage permissions={permissions} />
                    </TooltipProvider>
                </QueryClientProvider>,
            ),
        )
        await Promise.resolve()
    })
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

async function openActionMenu(container: HTMLElement): Promise<void> {
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Open actions"]')
    if (!trigger) throw new Error('Action menu trigger not found')
    await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
    })
    await waitFor(() => document.querySelector('[role="menuitem"]') !== null)
}

async function chooseActionMenuItem(label: string): Promise<void> {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (candidate) => candidate.textContent?.trim() === label,
    )
    if (!item) throw new Error(`Action menu item not found: ${label}`)
    await click(item)
    await waitFor(() => document.querySelector('[role="menu"]') === null)
    await waitFor(
        () =>
            document.activeElement === document.querySelector('button[aria-label="Open actions"]'),
    )
}
async function waitFor(condition: () => boolean, timeoutMs = 1_500): Promise<void> {
    const deadline = Date.now() + timeoutMs
    const waitUntil = async (): Promise<void> => {
        if (condition()) return
        if (Date.now() >= deadline) throw new Error('timed out waiting for UI state')
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
        await waitUntil()
    }
    await waitUntil()
}

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent?.trim() === label,
    )
    if (!button) throw new Error(`button not found: ${label}`)
    return button
}

beforeEach(() => {
    getProxyAccessLogsHandlerMock.mockClear()
})

afterEach(() => {
    activeRoot?.unmount()
    activeRoot = null
    activeQueryClient?.clear()
    activeQueryClient = null
    document.body.replaceChildren()
})

describe('proxy access-log UI', () => {
    test('applies filters only on submit, paginates, and refreshes the first page', async () => {
        const container = await renderPage([PERMISSIONS.PROXY_ACCESS_LOGS_VIEW])
        await waitFor(() => getProxyAccessLogsHandlerMock.mock.calls.length === 1)
        await waitFor(() => container.textContent?.includes('/dashboard') === true)
        expect(getProxyAccessLogsHandlerMock.mock.calls[0]?.[0]).toEqual({
            data: { limit: 100, offset: 0 },
        })
        expect(container.textContent).toContain('/dashboard')

        const hostInput = container.querySelector<HTMLInputElement>(
            'input[placeholder="example.com"]',
        )
        expect(hostInput).not.toBeNull()
        await setInputValue(hostInput!, 'app.example.com')
        expect(getProxyAccessLogsHandlerMock).toHaveBeenCalledTimes(1)

        await click(getButton(container, 'Apply filters'))
        await waitFor(() => getProxyAccessLogsHandlerMock.mock.calls.length === 2)
        expect(getProxyAccessLogsHandlerMock.mock.calls[1]?.[0]).toEqual({
            data: { host: 'app.example.com', limit: 100, offset: 0 },
        })

        const nextButton = container.querySelector<HTMLButtonElement>(
            'button[aria-label="Next page"]',
        )
        expect(nextButton).not.toBeNull()
        await waitFor(() => nextButton?.disabled === false)
        await click(nextButton!)
        await waitFor(() => getProxyAccessLogsHandlerMock.mock.calls.length === 3)
        await waitFor(() => container.textContent?.includes('/older') === true)
        expect(getProxyAccessLogsHandlerMock.mock.calls[2]?.[0]).toEqual({
            data: { host: 'app.example.com', limit: 100, offset: 100 },
        })
        expect(container.textContent).toContain('/older')

        await click(getButton(container, 'Refresh'))
        await waitFor(() => getProxyAccessLogsHandlerMock.mock.calls.length === 4)
        expect(getProxyAccessLogsHandlerMock.mock.calls[3]?.[0]).toEqual({
            data: { host: 'app.example.com', limit: 100, offset: 0 },
        })
        expect(container.textContent).toContain('/dashboard')
    })

    test('keeps draft filters when collapsed and resets them from the shared control', async () => {
        const container = await renderPage([PERMISSIONS.PROXY_ACCESS_LOGS_VIEW])
        await waitFor(() => container.textContent?.includes('/dashboard') === true)

        const filtersButton = getButton(container, 'Filters')
        expect(filtersButton.getAttribute('aria-expanded')).toBe('false')
        const hostInput = container.querySelector<HTMLInputElement>(
            'input[placeholder="example.com"]',
        )
        expect(hostInput).not.toBeNull()

        await click(filtersButton)
        expect(filtersButton.getAttribute('aria-expanded')).toBe('true')
        await setInputValue(hostInput!, 'app.example.com')
        await click(filtersButton)
        expect(filtersButton.getAttribute('aria-expanded')).toBe('false')
        expect(hostInput?.value).toBe('app.example.com')

        await click(getButton(container, 'Reset filters'))
        expect(hostInput?.value).toBe('')
        expect(getButton(container, 'Filters').textContent?.trim()).toBe('Filters')
    })

    test('opens request details from the action column while keeping time non-interactive', async () => {
        const container = await renderPage([PERMISSIONS.PROXY_ACCESS_LOGS_VIEW])
        await waitFor(() => container.textContent?.includes('/dashboard') === true)

        const timestamp = container.querySelector('time')
        expect(timestamp).not.toBeNull()
        expect(timestamp?.closest('button')).toBeNull()

        await openActionMenu(container)
        await chooseActionMenuItem('Show request details')
        expect(container.textContent).toContain('127.0.0.1:8080')
        expect(container.textContent).toContain('HTTP/2')

        await openActionMenu(container)
        await chooseActionMenuItem('Hide request details')
        expect(container.textContent).not.toContain('127.0.0.1:8080')
    })

    test('renders a restricted state and does not request logs without permission', async () => {
        const container = await renderPage([])
        await act(async () => {
            await Promise.resolve()
        })

        expect(container.textContent).toContain('Access logs are restricted')
        expect(getProxyAccessLogsHandlerMock).not.toHaveBeenCalled()
    })
})

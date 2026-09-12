import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import { PERMISSIONS } from '../config/permissions.config'
import type { AuditEventsQuery, AuditEventsResult } from '../shared/Types/audit-events.types'
import {
    toAuditEventsQuery,
    validateAuditLogsFilters,
} from '../features/Admin/AuditLogs/Helpers/auditLogs'
import type { AuditLogsFilters } from '../features/Admin/AuditLogs/Types/audit-logs.types'
import withTestLanguage from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('../shared/Tooltip')

const actorId = '018f2f52-7c1b-7cc0-9f3c-6a9952c54021'
const targetId = '018f2f52-7c1b-7cc0-9f3c-6a9952c54022'
const nextCursor = 'eyJ0aW1lc3RhbXAiOiIyMDI2LTA5LTEyVDEwOjAwOjAwLjAwMFoiLCJpZCI6IjAxOGYifQ'

const newestEvent = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54023',
    timestamp: '2026-09-12T12:00:00.000Z',
    actorUserId: actorId,
    actorKind: 'user',
    actorDisplayName: 'Alice Admin',
    action: 'update',
    resource: 'proxy-host',
    targetId,
    result: 'success',
    metadata: { changedFields: ['upstream'] },
} as const

const olderEvent = {
    ...newestEvent,
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54024',
    timestamp: '2026-09-12T10:00:00.000Z',
    action: 'delete',
    result: 'denied',
    metadata: { failureCode: 'permission_denied' },
} as const

const getAuditEventsHandlerMock = mock(
    async ({ data }: { readonly data: AuditEventsQuery }): Promise<AuditEventsResult> => {
        if (data.cursor === nextCursor) {
            return {
                events: [olderEvent],
                limit: data.limit ?? 100,
                nextCursor: null,
                hasMore: false,
            }
        }
        return {
            events: [newestEvent],
            limit: data.limit ?? 100,
            nextCursor,
            hasMore: true,
        }
    },
)

mock.module('../features/Admin/AuditLogs/server', () => ({
    getAuditEventsHandler: getAuditEventsHandlerMock,
}))

const { default: AuditLogsPage } = await import('../features/Admin/AuditLogs')

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
                        <AuditLogsPage permissions={permissions} />
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

async function chooseSelectOption(
    container: HTMLElement,
    ariaLabel: string,
    optionLabel: string,
): Promise<void> {
    const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`)
    expect(trigger).not.toBeNull()
    await act(async () => {
        trigger?.dispatchEvent(
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
    expect(option).not.toBeUndefined()
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
        (candidate) =>
            candidate.getAttribute('aria-label') === label ||
            candidate.textContent?.trim() === label,
    )
    if (!button) throw new Error(`button not found: ${label}`)
    return button
}

function getFilterPanel(container: HTMLElement, toggle: HTMLButtonElement): HTMLElement {
    const contentId = toggle.getAttribute('aria-controls')
    expect(contentId).not.toBeNull()
    const panel = container.ownerDocument.getElementById(contentId!)
    expect(panel).not.toBeNull()
    return panel!
}

function expectFilterTogglePlacement(toggle: HTMLButtonElement, panel: HTMLElement): void {
    const section = toggle.closest('section')
    expect(section).not.toBeNull()
    expect(section?.firstElementChild?.contains(toggle)).toBeTrue()
    expect(panel.closest('section')).toBe(section)
    expect(panel).not.toBe(section?.firstElementChild)
    expect(toggle.closest('table')).toBeNull()
    expect(panel.closest('table')).toBeNull()
}

beforeEach(() => {
    getAuditEventsHandlerMock.mockClear()
})

afterEach(() => {
    activeRoot?.unmount()
    activeRoot = null
    activeQueryClient?.clear()
    activeQueryClient = null
    document.body.replaceChildren()
})

describe('audit log UI', () => {
    test('uses strict UTC datetime boundaries for filters', () => {
        const impossibleDate: AuditLogsFilters = {
            actorUserId: '',
            action: '',
            resource: '',
            from: '2024-02-30T12:00',
            to: '',
        }
        expect(validateAuditLogsFilters(impossibleDate)).toEqual({
            from: 'admin.auditLogs.validation.dateTime',
        })

        const validDate: AuditLogsFilters = {
            ...impossibleDate,
            from: '2024-02-29T12:34',
            to: '2024-02-29T12:35',
        }
        expect(toAuditEventsQuery(validDate, undefined)).toMatchObject({
            from: '2024-02-29T12:34:00.000Z',
            to: '2024-02-29T12:35:59.999Z',
        })
    })

    test('applies filters only on submit and navigates keyset pages', async () => {
        const container = await renderPage([PERMISSIONS.AUDIT_LOGS_VIEW])
        await waitFor(() => getAuditEventsHandlerMock.mock.calls.length === 1)
        await waitFor(() => container.textContent?.includes('Alice Admin') === true)

        expect(getAuditEventsHandlerMock.mock.calls[0]?.[0]).toEqual({
            data: { limit: 100 },
        })
        expect(container.textContent).toContain('Update')
        expect(container.textContent).toContain('Success')

        const actorInput = container.querySelector<HTMLInputElement>(
            'input[placeholder="UUID of the actor"]',
        )
        expect(actorInput).not.toBeNull()
        await setInputValue(actorInput!, actorId)
        expect(getAuditEventsHandlerMock).toHaveBeenCalledTimes(1)

        await click(getButton(container, 'Apply filters'))
        await waitFor(() => getAuditEventsHandlerMock.mock.calls.length === 2)
        expect(getAuditEventsHandlerMock.mock.calls[1]?.[0]).toEqual({
            data: { actorUserId: actorId, limit: 100 },
        })

        const nextButton = container.querySelector<HTMLButtonElement>(
            'button[aria-label="Next page"]',
        )
        expect(nextButton).not.toBeNull()
        await waitFor(() => nextButton?.disabled === false)
        await click(nextButton!)
        await waitFor(() => getAuditEventsHandlerMock.mock.calls.length === 3)
        await waitFor(() => container.textContent?.includes('Denied') === true)
        expect(getAuditEventsHandlerMock.mock.calls[2]?.[0]).toEqual({
            data: { actorUserId: actorId, cursor: nextCursor, limit: 100 },
        })
        expect(container.textContent).toContain('Denied')

        const previousButton = container.querySelector<HTMLButtonElement>(
            'button[aria-label="Previous page"]',
        )
        expect(previousButton).not.toBeNull()
        await click(previousButton!)
        await waitFor(() => getAuditEventsHandlerMock.mock.calls.length === 4)
        expect(getAuditEventsHandlerMock.mock.calls[3]?.[0]).toEqual({
            data: { actorUserId: actorId, limit: 100 },
        })
    })

    test('keeps draft filters when collapsed and resets them from the shared control', async () => {
        const container = await renderPage([PERMISSIONS.AUDIT_LOGS_VIEW])
        await waitFor(() => container.textContent?.includes('Alice Admin') === true)

        const filtersButton = getButton(container, 'Filters')
        const filterPanel = getFilterPanel(container, filtersButton)
        expectFilterTogglePlacement(filtersButton, filterPanel)
        expect(filtersButton.getAttribute('aria-expanded')).toBe('false')
        const actorInput = container.querySelector<HTMLInputElement>(
            'input[placeholder="UUID of the actor"]',
        )
        expect(actorInput).not.toBeNull()

        await click(filtersButton)
        expect(filtersButton.getAttribute('aria-expanded')).toBe('true')
        await setInputValue(actorInput!, actorId)
        await click(filtersButton)
        expect(filtersButton.getAttribute('aria-expanded')).toBe('false')
        expect(actorInput?.value).toBe(actorId)

        await click(getButton(container, 'Reset filters'))
        expect(actorInput?.value).toBe('')
        expect(getButton(container, 'Filters').getAttribute('aria-label')).toBe('Filters')
    })

    test('applies selected action and resource values to the server query', async () => {
        const container = await renderPage([PERMISSIONS.AUDIT_LOGS_VIEW])
        await waitFor(() => getAuditEventsHandlerMock.mock.calls.length === 1)
        await waitFor(() => container.textContent?.includes('Alice Admin') === true)

        await click(getButton(container, 'Filters'))
        await chooseSelectOption(container, 'Action', 'Update')
        await chooseSelectOption(container, 'Resource', 'Proxy host')
        await click(getButton(container, 'Apply filters'))
        await waitFor(() => getAuditEventsHandlerMock.mock.calls.length === 2)

        expect(getAuditEventsHandlerMock.mock.calls[1]?.[0]).toEqual({
            data: { action: 'update', limit: 100, resource: 'proxy-host' },
        })
    })

    test('shows safe event details and blocks requests without permission', async () => {
        const container = await renderPage([PERMISSIONS.AUDIT_LOGS_VIEW])
        await waitFor(() => container.textContent?.includes('Alice Admin') === true)
        await openActionMenu(container)
        await chooseActionMenuItem('Show event details')
        expect(container.textContent).toContain('Changed fields')
        expect(container.textContent).toContain('upstream')

        await openActionMenu(container)
        await chooseActionMenuItem('Hide event details')
        expect(container.textContent).not.toContain('Changed fields')

        activeRoot?.unmount()
        activeRoot = null
        activeQueryClient?.clear()
        activeQueryClient = null
        document.body.replaceChildren()
        getAuditEventsHandlerMock.mockClear()

        const restricted = await renderPage([])
        await act(async () => {
            await Promise.resolve()
        })
        expect(restricted.textContent).toContain('Audit log is restricted')
        expect(getAuditEventsHandlerMock).not.toHaveBeenCalled()
    })
})

// oxlint-disable no-await-in-loop -- Poll bounded UI transitions after serial React commits.
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { ManagedBackupJob, ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'
import type { BackupsPageProps } from '@/features/Admin/Backups/Types/backups-ui.types.ts'
import getApplicationShellViewModel from '@/lib/ApplicationShell/applicationShell.ts'
import { backupSearchSchema } from '@/features/Admin/Backups/validation.ts'
import withTestLanguage, { catalogs } from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: BackupsPage } = await import('@/features/Admin/Backups/index.tsx')

class FakeSocket extends EventTarget {
    static instances: FakeSocket[] = []
    static OPEN = 1
    static CLOSED = 3
    readyState = FakeSocket.OPEN
    sent: string[] = []

    constructor(readonly url: URL) {
        super()
        FakeSocket.instances.push(this)
    }

    send(value: string) {
        this.sent.push(value)
    }
    close() {
        this.readyState = FakeSocket.CLOSED
        this.dispatchEvent(new Event('close'))
    }
    deliver(payload: ManagedBackupStatus) {
        this.dispatchEvent(
            new MessageEvent('message', {
                data: JSON.stringify({
                    type: 'snapshot',
                    topic: 'backups',
                    query: {},
                    payload,
                }),
            }),
        )
    }
}
const originalSocket = globalThis.WebSocket

async function statusChanged() {
    await act(async () => {
        const socket = FakeSocket.instances.at(-1)
        if (!socket) throw new Error('Missing backup realtime subscription')
        socket.dispatchEvent(new Event('open'))
        socket.deliver(structuredClone(status))
    })
}

async function openActions(id = completed.id) {
    const row = [...document.querySelectorAll('tbody tr')].find((item) =>
        item.textContent?.includes(id),
    )
    const trigger = row?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
    if (!trigger) throw new Error('Missing backup actions: ' + id)
    await click(trigger)
    await waitFor(() => !!document.querySelector('[role="menu"]'))
}

function menuItem(label: string) {
    const element = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
        item.textContent?.startsWith(label),
    )
    if (!element) throw new Error('Missing menu action: ' + label)
    return element
}

const userId = '01900000-0000-7000-8000-000000000099'
const uuid = (number: number) => `01900000-0000-7000-8000-${String(number).padStart(12, '0')}`
const configuration = {
    revision: 0,
    enabled: false,
    intervalHours: 24,
    retentionCount: 7,
    nextRunAt: null,
}
const completed: ManagedBackupJob = {
    id: uuid(1),
    requestId: uuid(11),
    actorId: userId,
    origin: 'manual',
    scheduledFor: null,
    state: 'succeeded',
    requestedAt: 1793448000000,
    startedAt: 1793448001000,
    finishedAt: 1793448031000,
    durationMs: 30_000,
    error: null,
    source: {
        imageId: null,
        version: 'v1.0.0-beta.3',
        revision: 'a'.repeat(40),
        buildSha256: 'b'.repeat(64),
    },
    artifact: { id: uuid(1), metadataSha256: 'c'.repeat(64), bytes: 1_048_576 },
    retained: true,
}
let status: ManagedBackupStatus
let statusError: number | null
let startError: number | null
let startErrorCode: 'unavailable' | 'appliance_required'
let admitBeforeStartFailure: boolean
let configurationError: number | null
let startRequests: Array<{ requestId: string }>
let configurationRequests: Array<Record<string, unknown>>
let actionRequests: Array<{ operation: string; body: Record<string, unknown> }>
let actionError: boolean
let configurationWait: Promise<void> | null
let root: Root | null = null
let queryClient: InstanceType<typeof QueryClient>
let restoreFetch: () => void
let props: BackupsPageProps

async function waitFor(check: () => boolean, maximumMs = 1000) {
    for (let attempt = 0; attempt < maximumMs / 10; attempt++) {
        if (check()) return
        await act(async () => {
            await Bun.sleep(10)
        })
    }
    expect(check()).toBeTrue()
}
async function renderPage(overrides: Partial<BackupsPageProps> = {}) {
    if (!root) {
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
        const container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
    }
    props = {
        userId,
        permissions: [PERMISSIONS.BACKUPS_VIEW, PERMISSIONS.BACKUPS_MANAGE],
        ...overrides,
    }
    await act(async () =>
        root?.render(
            withTestLanguage(
                <QueryClientProvider client={queryClient}>
                    <BackupsPage {...props} />
                </QueryClientProvider>,
            ),
        ),
    )
    await waitFor(() => !document.body.textContent?.includes('Loading backup history'))
}
function button(label: string) {
    const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent?.trim() === label,
    )
    if (!element) throw new Error('Missing button: ' + label)
    return element
}
async function click(element: Element) {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
}
async function input(name: string, value: string) {
    const element = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
    if (!element) throw new Error('Missing input: ' + name)
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            element,
            value,
        )
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
    })
}
async function submit() {
    await act(async () => {
        document
            .querySelector('form')
            ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
}

beforeEach(() => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
    FakeSocket.instances = []
    window.location.href = 'http://localhost/backups'
    status = {
        storeId: uuid(90),
        configuration: { ...configuration },
        jobs: [structuredClone(completed)],
        auditEvents: [],
    }
    statusError = null
    startError = null
    startErrorCode = 'unavailable'
    admitBeforeStartFailure = false
    configurationError = null
    startRequests = []
    configurationRequests = []
    actionRequests = []
    actionError = false
    configurationWait = null
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
        Object.assign(
            async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
                const path = String(url)
                if (path.endsWith('/status'))
                    return statusError
                        ? Response.json(
                              { error: statusError === 403 ? 'permission_denied' : 'unavailable' },
                              { status: statusError },
                          )
                        : Response.json(status)
                const body: unknown = JSON.parse(String(options?.body))
                if (path.endsWith('/delete') || path.endsWith('/restore')) {
                    const request = body as Record<string, unknown>
                    const operation = path.endsWith('/delete') ? 'delete' : 'restore'
                    actionRequests.push({ operation, body: request })
                    if (actionError)
                        return Response.json({ error: 'artifact_invalid' }, { status: 409 })
                    if (operation === 'delete')
                        status.jobs = status.jobs.filter((job) => job.id !== request.jobId)
                    return Response.json(status, { status: operation === 'restore' ? 202 : 200 })
                }
                if (path.endsWith('/start')) {
                    const request = body as { requestId: string }
                    startRequests.push(request)
                    if (startError && !admitBeforeStartFailure)
                        return Response.json({ error: startErrorCode }, { status: startError })
                    status.jobs.push({
                        ...completed,
                        id: uuid(3),
                        requestId: request.requestId,
                        state: 'queued',
                        artifact: null,
                        retained: false,
                        startedAt: null,
                        finishedAt: null,
                        durationMs: null,
                    })
                    if (startError) {
                        statusError = 503
                        return Response.json({ error: startErrorCode }, { status: startError })
                    }
                    return Response.json(status, { status: 202 })
                }
                const request = body as Record<string, unknown>
                configurationRequests.push(request)
                if (configurationWait) await configurationWait
                if (configurationError)
                    return Response.json(
                        { error: 'revision_conflict' },
                        { status: configurationError },
                    )
                status.configuration = {
                    revision: status.configuration.revision + 1,
                    enabled: Boolean(request.enabled),
                    intervalHours: Number(request.intervalHours),
                    retentionCount: Number(request.retentionCount),
                    nextRunAt: request.enabled ? 1793451600000 : null,
                }
                return Response.json(status)
            },
            { preconnect: fetch.preconnect },
        ),
    )
    restoreFetch = () => fetchSpy.mockRestore()
})
afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    queryClient?.clear()
    document.body.innerHTML = ''
    restoreFetch()
    globalThis.WebSocket = originalSocket
})

describe('managed backup UI', () => {
    test('shows verified recovery points, source release, failures and expired artifacts', async () => {
        status.jobs.push(
            { ...completed, id: uuid(2), requestId: uuid(12), retained: false },
            {
                ...completed,
                id: uuid(4),
                requestId: uuid(14),
                state: 'interrupted',
                error: 'interrupted',
                artifact: null,
                retained: false,
            },
        )
        await renderPage()
        expect(document.body.textContent).toContain('v1.0.0-beta.3')
        expect(document.querySelector('button[aria-label="Sort by Requested"]')).not.toBeNull()
        expect(document.querySelector('td[aria-label="Source release cell"]')).not.toBeNull()
        expect(document.body.textContent).toContain('1 MiB')
        expect(document.body.textContent).toContain('not a confirmed recovery point')
        expect(document.body.textContent).not.toContain('Refresh backups')
        await openActions()
        const links = document.querySelectorAll<HTMLAnchorElement>('a[href^="/api/admin/backups/"]')
        expect(links.length).toBe(1)
        expect(links[0]?.getAttribute('href')).toBe(`/api/admin/backups/${completed.id}/download`)
        expect(menuItem('Restore backup').getAttribute('aria-disabled')).not.toBe('true')
        expect(document.body.textContent).toContain('application encryption key')
    })
    test('read-only access shows history without management or secret-bearing downloads', async () => {
        await renderPage({ permissions: [PERMISSIONS.BACKUPS_VIEW] })
        expect(document.querySelector('form')).toBeNull()
        expect(document.querySelector('a[href^="/api/admin/backups/"]')).toBeNull()
        expect(document.body.textContent).toContain('backup management permission')
        expect(document.body.textContent).not.toContain('Create backup')
        await openActions()
        expect(menuItem('Restore').getAttribute('aria-disabled')).toBe('true')
        expect(menuItem('Delete').getAttribute('aria-disabled')).toBe('true')
    })
    test('delete requires confirmation, cancels safely and removes only the selected row', async () => {
        status.jobs.push({ ...completed, id: uuid(2), requestId: uuid(12), retained: false })
        await renderPage()
        await openActions(uuid(2))
        expect(menuItem('Download').getAttribute('aria-disabled')).toBe('true')
        expect(menuItem('Restore').getAttribute('aria-disabled')).toBe('true')
        expect(menuItem('Delete').getAttribute('aria-disabled')).not.toBe('true')
        await click(menuItem('Delete'))
        expect(actionRequests).toHaveLength(0)
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(uuid(2))
        await click(button('Cancel'))
        expect(actionRequests).toHaveLength(0)
        await openActions(uuid(2))
        await click(menuItem('Delete'))
        const confirm =
            document.querySelector<HTMLButtonElement>('[role="dialog"] button.bg-danger') ??
            [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
                (item) => item.textContent?.startsWith('Delete'),
            )
        if (!confirm) throw new Error('Missing delete confirmation')
        await click(confirm)
        await waitFor(
            () => actionRequests.length === 1 && !document.querySelector('[role="dialog"]'),
        )
        expect(actionRequests[0]?.operation).toBe('delete')
        expect(actionRequests[0]?.body.jobId).toBe(uuid(2))
        expect(document.body.textContent).not.toContain(uuid(2))
        expect(document.body.textContent).toContain(completed.id)
    })
    test('restore requires destructive confirmation and surfaces real endpoint failures', async () => {
        actionError = true
        await renderPage()
        await openActions()
        await click(menuItem('Restore'))
        expect(actionRequests).toHaveLength(0)
        const dialog = document.querySelector('[role="dialog"]')
        expect(dialog?.textContent).toContain(completed.id)
        const confirm = [
            ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
        ].find((item) => item.textContent?.startsWith('Restore'))
        if (!confirm) throw new Error('Missing restore confirmation')
        await click(confirm)
        await waitFor(
            () => actionRequests.length === 1 && !document.querySelector('[role="dialog"]'),
        )
        expect(actionRequests[0]?.operation).toBe('restore')
        expect(actionRequests[0]?.body.metadataSha256).toBe(completed.artifact?.metadataSha256)
        expect(document.body.textContent).not.toContain('Restore request recorded')
        expect(document.body.textContent).toContain(
            catalogs.en.admin.backups.errors.artifact_invalid,
        )
        expect(document.body.textContent).toContain(completed.id)
    })
    test('a confirmation becomes disabled when another operation starts through realtime', async () => {
        await renderPage()
        await openActions()
        await click(menuItem('Delete'))
        status.jobs.push({
            ...completed,
            id: uuid(3),
            requestId: uuid(13),
            state: 'running',
            artifact: null,
            retained: false,
        })
        await statusChanged()
        const confirm = [
            ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
        ].find((item) => item.textContent?.startsWith('Delete'))
        await waitFor(() => confirm?.disabled === true)
        if (confirm) await click(confirm)
        expect(actionRequests).toHaveLength(0)
    })
    test('status filter options render the same colored badges as history rows', async () => {
        await renderPage()
        const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="Filters"]')
        if (!toggle) throw new Error('Missing table filter toggle')
        await click(toggle)
        const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
        const select = panel?.querySelectorAll<HTMLElement>('[role="combobox"]')[1]
        if (!select) throw new Error('Missing status filter')
        await click(select)
        await waitFor(() => !!document.querySelector('[role="option"]'))
        const succeeded = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
            (item) => item.textContent?.includes('Completed'),
        )
        const failed = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
            item.textContent?.includes('Failed'),
        )
        expect(succeeded).toBeDefined()
        expect(failed).toBeDefined()
        expect(succeeded!.querySelector('.bg-success-bg')).not.toBeNull()
        expect(failed!.querySelector('.bg-danger-bg')).not.toBeNull()
    })
    test('no view permission neither requests status nor exposes a cached recovery point', async () => {
        await renderPage({ permissions: [] })
        expect(document.body.textContent).toContain('Backup access is unavailable')
        expect(document.body.textContent).not.toContain(completed.id)
        expect(queryClient.getQueryData(['backups', userId])).toBeUndefined()
    })
    test('requires maintenance confirmation and admits only one request for repeated clicks', async () => {
        await renderPage()
        await click(button('Create backup'))
        expect(startRequests.length).toBe(0)
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('proxy traffic')
        const confirm = button('Start backup maintenance')
        await act(async () => {
            confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
        await waitFor(
            () => startRequests.length === 1 && !document.querySelector('[role="dialog"]'),
        )
        expect(button('Create backup').disabled).toBeTrue()
        expect(document.body.textContent).toContain('Queued')
    })
    test('a known demo rejection explains the missing appliance without claiming uncertain admission', async () => {
        startError = 409
        startErrorCode = 'appliance_required'
        await renderPage()
        await click(button('Create backup'))
        await click(button('Start backup maintenance'))
        await waitFor(
            () => document.body.textContent?.includes('Linux appliance backup service') === true,
        )
        expect(document.body.textContent).not.toContain('request result could not be confirmed')
        expect(document.body.textContent).not.toContain('Retry backup request')
        expect(document.body.textContent).not.toContain('Backup request recorded')
        expect(button('Create backup').disabled).toBeFalse()
        expect(status.jobs).toHaveLength(1)
    })
    test('retries an uncertain admission with the same request identity', async () => {
        startError = 503
        await renderPage()
        await click(button('Create backup'))
        await click(button('Start backup maintenance'))
        await waitFor(() => document.body.textContent?.includes('Retry backup request') === true)
        expect(document.body.textContent).toContain('reuses its identity')
        startError = null
        await click(button('Retry backup request'))
        await click(button('Start backup maintenance'))
        await waitFor(() => startRequests.length === 2)
        expect(startRequests[1]?.requestId).toBe(startRequests[0]?.requestId)
    })
    test('realtime reconciles a recorded request whose response was lost during maintenance', async () => {
        admitBeforeStartFailure = true
        startError = 503
        await renderPage()
        await click(button('Create backup'))
        await click(button('Start backup maintenance'))
        await waitFor(() => document.body.textContent?.includes('could not be confirmed') === true)
        statusError = null
        await statusChanged()
        await waitFor(
            () => document.body.textContent?.includes('Backup request recorded') === true,
            6500,
        )
        expect(startRequests.length).toBe(1)
        expect(button('Create backup').disabled).toBeTrue()
        expect(document.body.textContent).toContain('Queued')
        expect(document.body.textContent).not.toContain('reuses its identity')
    }, 8000)
    test('realtime updates a running backup to a completed recovery point', async () => {
        status.jobs = [{ ...completed, state: 'running', artifact: null, retained: false }]
        await renderPage()
        expect(button('Create backup').disabled).toBeTrue()
        status.jobs = [structuredClone(completed)]
        await statusChanged()
        await waitFor(() => document.body.textContent?.includes('No backup running') === true, 6500)
        expect(button('Create backup').disabled).toBeFalse()
        await openActions()
        expect(menuItem('Download backup').getAttribute('aria-disabled')).not.toBe('true')
    }, 8000)
    test('saves numeric settings with a revision and prevents duplicate submissions', async () => {
        await renderPage()
        await input('intervalHours', '48')
        await input('retentionCount', '12')
        let release!: () => void
        configurationWait = new Promise((resolve) => {
            release = resolve
        })
        await submit()
        await submit()
        expect(configurationRequests.length).toBe(1)
        expect(configurationRequests[0]).toMatchObject({
            expectedRevision: 0,
            intervalHours: 48,
            retentionCount: 12,
            enabled: false,
        })
        await act(async () => release())
        await waitFor(() => document.body.textContent?.includes('retention saved') === true)
        expect(button('Save backup settings').disabled).toBeTrue()
    })
    test('keeps dirty edits when another operator changes the schedule, then explicitly reloads', async () => {
        await renderPage()
        await input('intervalHours', '48')
        status.configuration = { ...status.configuration, revision: 1, intervalHours: 72 }
        await statusChanged()
        await waitFor(() => document.body.textContent?.includes('changed elsewhere') === true)
        expect(document.querySelector<HTMLInputElement>('[name="intervalHours"]')?.value).toBe('48')
        expect(button('Save backup settings').disabled).toBeTrue()
        await click(button('Load current settings'))
        expect(document.querySelector<HTMLInputElement>('[name="intervalHours"]')?.value).toBe('72')
        expect(configurationRequests.length).toBe(0)
    })
    test('blocks invalid numbers without submitting them to the appliance', async () => {
        await renderPage()
        await input('retentionCount', '0')
        await submit()
        expect(configurationRequests.length).toBe(0)
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('1–50')
    })
    test('keeps history during maintenance but locks controls until status recovers', async () => {
        await renderPage()
        statusError = 503
        await act(async () => {
            await queryClient.invalidateQueries({ queryKey: ['backups', userId] })
        })
        await waitFor(() => document.body.textContent?.includes('temporarily unavailable') === true)
        expect(document.body.textContent).toContain(completed.id)
        expect(button('Create backup').disabled).toBeTrue()
        expect(document.querySelector('a[href^="/api/admin/backups/"]')).toBeNull()
        statusError = null
        await act(async () => {
            await queryClient.invalidateQueries({ queryKey: ['backups', userId] })
        })
        await waitFor(() => !button('Create backup').disabled)
    })
    test('erases history and controls after a server authorization failure', async () => {
        await renderPage()
        statusError = 403
        await act(async () => {
            await queryClient.invalidateQueries({ queryKey: ['backups', userId] })
        })
        await waitFor(
            () => document.body.textContent?.includes('Backup access is unavailable') === true,
        )
        expect(document.body.textContent).not.toContain(completed.id)
        expect(queryClient.getQueryData(['backups', userId])).toBeUndefined()
    })
    test('does not repopulate cached history from a late save after permission revocation', async () => {
        await renderPage()
        await input('retentionCount', '12')
        let release!: () => void
        configurationWait = new Promise((resolve) => {
            release = resolve
        })
        await submit()
        expect(configurationRequests.length).toBe(1)
        await renderPage({ permissions: [] })
        await act(async () => release())
        await Bun.sleep(15)
        expect(document.body.textContent).not.toContain(completed.id)
        expect(queryClient.getQueryData(['backups', userId])).toBeUndefined()
    })
    test('shows a safe download failure and validates redirect search values', async () => {
        await renderPage({ downloadError: 'not_found' })
        expect(document.querySelector('[role="alert"]')?.textContent).toContain(
            'no longer available',
        )
        expect(backupSearchSchema.parse({ downloadError: '<script>private</script>' })).toEqual({
            downloadError: undefined,
        })
        expect(
            getApplicationShellViewModel(
                { permissions: [PERMISSIONS.BACKUPS_VIEW] },
                (key) => key,
            ).navigationItems.some((item) => item.to === '/backups'),
        ).toBeTrue()
        expect(
            getApplicationShellViewModel({ permissions: [] }, (key) => key).navigationItems.some(
                (item) => item.to === '/backups',
            ),
        ).toBeFalse()
        for (const catalog of Object.values(catalogs))
            expect(Object.keys(catalog.admin.backups)).toEqual(
                Object.keys(catalogs.en.admin.backups),
            )
    })
})

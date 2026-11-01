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
let admitBeforeStartFailure: boolean
let configurationError: number | null
let startRequests: Array<{ requestId: string }>
let configurationRequests: Array<Record<string, unknown>>
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
    status = {
        storeId: uuid(90),
        configuration: { ...configuration },
        jobs: [structuredClone(completed)],
        auditEvents: [],
    }
    statusError = null
    startError = null
    admitBeforeStartFailure = false
    configurationError = null
    startRequests = []
    configurationRequests = []
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
                if (path.endsWith('/start')) {
                    const request = body as { requestId: string }
                    startRequests.push(request)
                    if (startError && !admitBeforeStartFailure)
                        return Response.json({ error: 'unavailable' }, { status: startError })
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
                        return Response.json({ error: 'unavailable' }, { status: startError })
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
        expect(document.body.textContent).toContain('1 MiB')
        expect(document.body.textContent).toContain('No longer retained')
        expect(document.body.textContent).toContain('not a confirmed recovery point')
        const links = document.querySelectorAll<HTMLAnchorElement>('a[href^="/api/admin/backups/"]')
        expect(links.length).toBe(1)
        expect(links[0]?.getAttribute('href')).toBe(`/api/admin/backups/${completed.id}/download`)
        expect(links[0]?.getAttribute('aria-label')).toContain(completed.id)
        expect(document.body.textContent).toContain('application encryption key')
    })
    test('read-only access shows history without management or secret-bearing downloads', async () => {
        await renderPage({ permissions: [PERMISSIONS.BACKUPS_VIEW] })
        expect(document.querySelector('form')).toBeNull()
        expect(document.querySelector('a[href^="/api/admin/backups/"]')).toBeNull()
        expect(document.body.textContent).toContain('backup management permission')
        expect(document.body.textContent).not.toContain('Create backup')
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
    test('polling reconciles a recorded request whose response was lost during maintenance', async () => {
        admitBeforeStartFailure = true
        startError = 503
        await renderPage()
        await click(button('Create backup'))
        await click(button('Start backup maintenance'))
        await waitFor(() => document.body.textContent?.includes('could not be confirmed') === true)
        statusError = null
        await waitFor(
            () => document.body.textContent?.includes('Backup request recorded') === true,
            6500,
        )
        expect(startRequests.length).toBe(1)
        expect(button('Create backup').disabled).toBeTrue()
        expect(document.body.textContent).toContain('Queued')
        expect(document.body.textContent).not.toContain('reuses its identity')
    }, 8000)
    test('polling updates a running backup to a completed downloadable recovery point without interaction', async () => {
        status.jobs = [{ ...completed, state: 'running', artifact: null, retained: false }]
        await renderPage()
        expect(button('Create backup').disabled).toBeTrue()
        status.jobs = [structuredClone(completed)]
        await waitFor(() => document.body.textContent?.includes('No backup running') === true, 6500)
        expect(button('Create backup').disabled).toBeFalse()
        expect(document.querySelector('a[href^="/api/admin/backups/"]')).not.toBeNull()
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
        await click(button('Refresh backups'))
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
        await click(button('Refresh backups'))
        await waitFor(() => document.body.textContent?.includes('temporarily unavailable') === true)
        expect(document.body.textContent).toContain(completed.id)
        expect(button('Create backup').disabled).toBeTrue()
        expect(document.querySelector('a[href^="/api/admin/backups/"]')).toBeNull()
        statusError = null
        await click(button('Refresh backups'))
        await waitFor(() => !button('Create backup').disabled)
    })
    test('erases history and controls after a server authorization failure', async () => {
        await renderPage()
        statusError = 403
        await click(button('Refresh backups'))
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

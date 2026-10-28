import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type { DomainCheckDialogProps } from '@/features/Admin/RuntimeDiagnostics/Components/DomainCheckDialog/Types/domain-check-dialog.types.ts'
import { PERMISSIONS, RUNTIME_SUPPORT_REPORT_PERMISSIONS } from '@/config/permissions.config.ts'
import {
    domainDiagnosticsFixture,
    domainDiagnosticsInput,
} from '@/tests/lib/RuntimeDiagnostics/domain-diagnostics.fixture.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'
import { createRuntimeSupportReport } from '@/lib/RuntimeDiagnostics/runtimeSupportReport.ts'
import type { RuntimeSupportReport } from '@/lib/RuntimeDiagnostics/Types/runtime-support-report.types.ts'
import { supportReportFixture } from '@/tests/lib/RuntimeDiagnostics/runtime-support-report.fixture.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { default: withTestPageAlerts } = await import('@/tests/Helpers/withTestPageAlerts.tsx')
const exportReport = mock(async (): Promise<RuntimeSupportReport> => {
    throw new Error('Support report not requested')
})
mock.module('@/features/Admin/RuntimeDiagnostics/middleware.ts', () => ({
    exportRuntimeSupportReportHandler: exportReport,
}))
const { default: DomainCheckDialog } =
    await import('@/features/Admin/RuntimeDiagnostics/Components/DomainCheckDialog/index.tsx')
const fetchMock = spyOn(globalThis, 'fetch')

afterAll(() => fetchMock.mockRestore())
const copy = mock(async (_value: string) => {})
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
let root: Root | null = null
let client: InstanceType<typeof QueryClient>
let props: DomainCheckDialogProps

function dialog(): HTMLElement {
    const element = document.querySelector<HTMLElement>('[role="dialog"]')
    if (!element) throw new Error('Domain check dialog is not open')
    return element
}

function button(label: string): HTMLButtonElement {
    const element = [...dialog().querySelectorAll('button')].find(
        (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
    )
    if (!element) throw new Error(`Missing dialog action: ${label}`)
    return element
}

async function render(changes: Partial<DomainCheckDialogProps> = {}) {
    props = { ...props, ...changes }
    await act(async () =>
        root?.render(
            withTestLanguage(
                withTestPageAlerts(
                    <QueryClientProvider client={client}>
                        <DomainCheckDialog {...props} />
                    </QueryClientProvider>,
                ),
            ),
        ),
    )
}

async function click(label: string) {
    await act(async () => button(label).click())
}

function deferResponse() {
    let resolve!: (value: Response) => void
    fetchMock.mockReturnValueOnce(
        new Promise<Response>((complete) => {
            resolve = complete
        }),
    )
    return async () =>
        act(async () => {
            resolve(Response.json(domainDiagnosticsFixture()))
            await new Promise((complete) => setTimeout(complete, 10))
        })
}

beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(Response.json(domainDiagnosticsFixture()))
    copy.mockClear()
    exportReport.mockReset()
    exportReport.mockRejectedValue(new Error('Support report not requested'))
    client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    props = {
        open: true,
        onOpenChange: mock(() => {}),
        hostType: 'proxy',
        host: {
            id: domainDiagnosticsInput.hostId,
            domains: [domainDiagnosticsInput.domain],
            updatedAt: new Date('2026-10-28T10:00:00Z'),
            enabled: true,
        },
        permissions: [PERMISSIONS.APP_ACCESS, ...RUNTIME_SUPPORT_REPORT_PERMISSIONS],
    }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    client.clear()
    document.body.replaceChildren()
})

describe('explicit domain-check dialog', () => {
    test('waits for explicit run and presents a labelled modal with four stage outcomes', async () => {
        await render()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(exportReport).not.toHaveBeenCalled()
        const titleId = dialog().getAttribute('aria-labelledby')!
        expect(document.getElementById(titleId)?.textContent).toBe('Domain check')
        expect(button('Run check').disabled).toBe(false)
        await click('Run check')
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual(
            domainDiagnosticsInput,
        )
        expect(dialog().textContent).toContain('192.0.2.1')
        expect(dialog().textContent).toContain('200')
        expect(button('Run again').disabled).toBe(false)
    })

    test('blocks duplicate activation and cancels late responses without publishing them', async () => {
        const finish = deferResponse()
        await render()
        await act(async () => {
            button('Run check').click()
            button('Run check').click()
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const signal = fetchMock.mock.calls[0]![1]!.signal!
        await click('Cancel check')
        expect(signal.aborted).toBe(true)
        await finish()
        expect(dialog().textContent).not.toContain('192.0.2.1')
        expect(copy).not.toHaveBeenCalled()
        await click('Run check')
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(dialog().textContent).toContain('192.0.2.1')
    })

    test('copies a privacy-safe summary only after explicit activation', async () => {
        await render()
        expect(copy).not.toHaveBeenCalled()
        await click('Run check')
        await click('Copy summary')
        expect(copy).toHaveBeenCalledTimes(1)
        const summary = copy.mock.calls[0]![0]
        expect(JSON.parse(summary).stages.dns.code).toBe('dns_resolved')
        for (const value of [
            domainDiagnosticsInput.hostId,
            domainDiagnosticsInput.domain,
            '192.0.2.1',
            '2001:db8::1',
            'sha256:',
        ])
            expect(summary).not.toContain(value)
    })

    test.each([
        { error: 'rate_limited', status: 429 },
        { error: 'busy', status: 503 },
        { error: 'runtime_unavailable', status: 503 },
        { error: 'PRIVATE-CREDENTIAL', status: 500 },
    ])('offers retry after $error without exposing raw server text', async ({ error, status }) => {
        fetchMock.mockResolvedValueOnce(Response.json({ error }, { status }))
        await render()
        await click('Run check')
        expect(dialog().textContent).not.toContain('PRIVATE-CREDENTIAL')
        expect(dialog().querySelector('[role="alert"]')).not.toBeNull()
        await click('Run again')
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(dialog().textContent).toContain('192.0.2.1')
    })

    test.each(['identity', 'domains', 'revision', 'enabled', 'permission', 'close'] as const)(
        'suppresses late results after a %s change',
        async (change) => {
            const finish = deferResponse()
            await render()
            await click('Run check')
            const signal = fetchMock.mock.calls[0]![1]!.signal!
            await render(
                change === 'permission'
                    ? { permissions: [] }
                    : change === 'close'
                      ? { open: false }
                      : {
                            host: {
                                ...props.host,
                                ...(change === 'identity'
                                    ? { id: '0198d98a-0000-7000-8000-000000000002' }
                                    : {}),
                                ...(change === 'domains' ? { domains: ['other.example.com'] } : {}),
                                ...(change === 'revision'
                                    ? { updatedAt: new Date('2026-10-28T11:00:00Z') }
                                    : {}),
                                ...(change === 'enabled' ? { enabled: false } : {}),
                            },
                        },
            )
            expect(signal.aborted).toBe(true)
            await finish()
            expect(document.body.textContent).not.toContain('192.0.2.1')
        },
    )

    test('aborts outstanding work when the dialog unmounts', async () => {
        const finish = deferResponse()
        await render()
        await click('Run check')
        const signal = fetchMock.mock.calls[0]![1]!.signal!
        await act(async () => root?.unmount())
        root = null
        expect(signal.aborted).toBe(true)
        await finish()
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
})

describe('domain-check freshness and diagnostic interpretation', () => {
    test('does not offer a runnable check without the host read permission', async () => {
        await render({ permissions: [PERMISSIONS.APP_ACCESS] })
        expect(fetchMock).not.toHaveBeenCalled()
        expect(button('Run check').disabled).toBe(true)
    })

    test.each(['proxy-hosts', 'redirect-hosts'] as const)(
        'cancels checks when the %s cache is invalidated',
        async (prefix) => {
            client.setQueryData(['admin', prefix, 'page'], { hosts: [] })
            const finish = deferResponse()
            await render()
            await click('Run check')
            const signal = fetchMock.mock.calls[0]![1]!.signal!
            await act(async () => client.invalidateQueries({ queryKey: ['admin', prefix] }))
            expect(signal.aborted).toBe(true)
            await finish()
            expect(dialog().textContent).not.toContain('192.0.2.1')
            expect(dialog().textContent).toContain('Run a fresh check')
        },
    )

    test.each(['proxy-hosts', 'redirect-hosts'] as const)(
        'removes completed results when the %s cache is removed',
        async (prefix) => {
            client.setQueryData(['admin', prefix, 'page'], { hosts: [] })
            await render()
            await click('Run check')
            expect(dialog().textContent).toContain('192.0.2.1')
            await act(async () => client.removeQueries({ queryKey: ['admin', prefix] }))
            expect(dialog().textContent).not.toContain('192.0.2.1')
            expect(button('Copy summary').disabled).toBe(true)
        },
    )

    test('shows stage failures with targeted recovery advice', async () => {
        const fixture = domainDiagnosticsFixture()
        fetchMock.mockResolvedValueOnce(
            Response.json({
                ...fixture,
                stages: {
                    ...fixture.stages,
                    dns: {
                        status: 'failed',
                        code: 'dns_not_found',
                        durationMs: 3,
                        addresses: [],
                        httpStatus: null,
                    },
                    upstream: {
                        status: 'failed',
                        code: 'upstream_error',
                        durationMs: 4,
                        addresses: [],
                        httpStatus: 503,
                    },
                    tls: {
                        status: 'failed',
                        code: 'tls_failed',
                        durationMs: 5,
                        addresses: [],
                        httpStatus: null,
                    },
                },
            }),
        )
        await render()
        await click('Run check')
        const text = dialog().textContent!
        expect(text).toContain('Failed')
        expect(text).toContain('DNS records')
        expect(text).toContain('target service and its logs')
        expect(text).toContain('trusted certificate authorities')
        expect(text).toContain('HTTP 503')
    })

    test('keeps unknown configuration and skipped checks distinct from confirmation', async () => {
        const fixture = domainDiagnosticsFixture()
        const skipped = {
            status: 'unknown',
            code: 'skipped',
            durationMs: 0,
            addresses: [],
            httpStatus: null,
        }
        fetchMock.mockResolvedValueOnce(
            Response.json({
                ...fixture,
                activeRevision: null,
                stages: {
                    configuration: { ...skipped, code: 'configuration_stale' },
                    dns: skipped,
                    upstream: skipped,
                    tls: skipped,
                },
            }),
        )
        await render()
        await click('Run check')
        expect(dialog().textContent).toContain('Unknown')
        expect(dialog().textContent).toContain('Apply the latest desired configuration')
        expect(dialog().textContent).toContain('Resolve the configuration issue')
        expect(dialog().textContent).not.toContain('Confirmed')
    })

    test('identifies redirect targets as not applicable without claiming destination reachability', async () => {
        const fixture = domainDiagnosticsFixture()
        const skipped = {
            status: 'not_applicable',
            code: 'redirect_host',
            durationMs: 0,
            addresses: [],
            httpStatus: null,
        }
        fetchMock.mockResolvedValueOnce(
            Response.json({
                ...fixture,
                hostType: 'redirect',
                stages: { ...fixture.stages, upstream: skipped, tls: skipped },
            }),
        )
        await render({ hostType: 'redirect' })
        await click('Run check')
        expect(dialog().textContent).toContain('Not applicable')
        expect(dialog().textContent).toContain('Redirect destinations are not checked')
        expect(dialog().textContent).toContain('do not prove public internet reachability')
    })

    test('an HTTP target does not imply verified TLS', async () => {
        const fixture = domainDiagnosticsFixture()
        fetchMock.mockResolvedValueOnce(
            Response.json({
                ...fixture,
                stages: {
                    ...fixture.stages,
                    tls: {
                        status: 'not_applicable',
                        code: 'http_upstream',
                        durationMs: 0,
                        addresses: [],
                        httpStatus: null,
                    },
                },
            }),
        )
        await render()
        await click('Run check')
        expect(dialog().textContent).toContain('The target uses HTTP, so TLS does not apply')
        expect(dialog().textContent).toContain('Not applicable')
        expect(dialog().textContent).not.toContain('verified the target’s TLS certificate')
    })
})

test('keyboard domain selection stays available while pending and cancels the old identity', async () => {
    const finish = deferResponse()
    await render({
        host: { ...props.host, domains: [domainDiagnosticsInput.domain, 'second.example.com'] },
    })
    await click('Run check')
    const signal = fetchMock.mock.calls[0]![1]!.signal!
    expect(button('Run check').disabled).toBe(true)
    expect(button('Copy summary').disabled).toBe(true)
    const stages = dialog().querySelectorAll('section[aria-labelledby]')
    expect(stages).toHaveLength(4)
    for (const stage of stages) expect(stage.textContent).toContain('Pending')
    expect(dialog().querySelector('output[aria-live="polite"]')?.textContent).toContain(
        'Checking the domain',
    )
    const chooser = dialog().querySelector<HTMLElement>('[role="combobox"]')!
    expect(chooser.getAttribute('aria-label')).toBe('Domain')
    expect(chooser.getAttribute('aria-disabled')).not.toBe('true')
    await act(async () => {
        chooser.focus()
        chooser.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        )
    })
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (item) => item.textContent?.trim() === 'second.example.com',
    )!
    expect(option).toBeDefined()
    await act(async () => {
        option.focus()
        option.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        )
    })
    expect(signal.aborted).toBe(true)
    await finish()
    expect(dialog().textContent).not.toContain('192.0.2.1')
    expect(chooser.textContent).toContain('second.example.com')
    fetchMock.mockResolvedValueOnce(
        Response.json({ ...domainDiagnosticsFixture(), domain: 'second.example.com' }),
    )
    await click('Run check')
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).domain).toBe(
        'second.example.com',
    )
})

test('Escape closes an active check, cancels work, and restores the opening control focus', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open domain check'
    document.body.prepend(trigger)
    trigger.focus()
    const finish = deferResponse()
    await render()
    expect(dialog().contains(document.activeElement)).toBe(true)
    await click('Run check')
    const signal = fetchMock.mock.calls[0]![1]!.signal!
    await act(async () =>
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        ),
    )
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(signal.aborted).toBe(true)
    await render({ open: false })
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(document.activeElement === trigger).toBe(true)
    await finish()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
})

test('a cancelled older completion cannot replace a newer pending attempt', async () => {
    const finishOld = deferResponse()
    await render()
    await click('Run check')
    await click('Cancel check')
    const finishNew = deferResponse()
    await click('Run check')
    const newSignal = fetchMock.mock.calls[1]![1]!.signal!
    await finishOld()
    expect(newSignal.aborted).toBe(false)
    expect(button('Run check').disabled).toBe(true)
    expect(dialog().textContent).not.toContain('192.0.2.1')
    await finishNew()
    expect(dialog().textContent).toContain('192.0.2.1')
    expect(button('Run again').disabled).toBe(false)
})

test('removing the last persisted domain clears the result and disables further checks', async () => {
    await render()
    await click('Run check')
    expect(dialog().textContent).toContain('192.0.2.1')
    await render({ host: { ...props.host, domains: [] } })
    expect(dialog().textContent).not.toContain('192.0.2.1')
    expect(button('Run check').disabled).toBe(true)
    expect(button('Copy summary').disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('host invalidation in the same event as starting a check suppresses its late result', async () => {
    client.setQueryData(['admin', 'proxy-hosts', 'page'], { hosts: [] })
    const finish = deferResponse()
    await render()
    await act(async () => {
        button('Run check').click()
        await client.invalidateQueries({ queryKey: ['admin', 'proxy-hosts'] })
    })
    await finish()
    expect(dialog().textContent).not.toContain('192.0.2.1')
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true)
})

test('support-report failures stay visible in the modal and the same icon retries the download', async () => {
    const report = createRuntimeSupportReport(
        supportReportFixture(),
        new Date('2026-10-06T10:00:00Z'),
    )
    exportReport.mockRejectedValueOnce(new Error('PRIVATE-SUPPORT-ERROR'))
    exportReport.mockResolvedValueOnce(report)
    const createUrl = spyOn(URL, 'createObjectURL').mockReturnValue('blob:modal-support-report')
    const download = spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
        await render()
        const trigger = button('Download support report')
        await act(async () => trigger.click())
        const feedback = [...dialog().querySelectorAll('output[aria-live="polite"]')].find((item) =>
            item.textContent?.includes('could not be downloaded'),
        )
        expect(feedback).toBeDefined()
        expect(feedback!.closest('.sr-only, [hidden], [aria-hidden="true"]')).toBeNull()
        expect(dialog().textContent).not.toContain('PRIVATE-SUPPORT-ERROR')
        expect(document.querySelector('button[data-severity]')).toBeNull()
        expect(button('Download support report').disabled).toBe(false)
        expect(createUrl).not.toHaveBeenCalled()
        await click('Download support report')
        expect(exportReport).toHaveBeenCalledTimes(2)
        expect(download).toHaveBeenCalledTimes(1)
        expect(createUrl).toHaveBeenCalledTimes(1)
        expect(dialog().textContent).toContain('download started')
    } finally {
        createUrl.mockRestore()
        download.mockRestore()
    }
})

test('partial support reports download and explain incompleteness visibly inside the modal', async () => {
    const report = {
        ...createRuntimeSupportReport(supportReportFixture(), new Date('2026-10-06T10:00:00Z')),
        completeness: 'partial' as const,
        unavailableSections: ['valkey'],
    }
    exportReport.mockResolvedValueOnce(report)
    const createUrl = spyOn(URL, 'createObjectURL').mockReturnValue('blob:modal-partial-report')
    const download = spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
        await render()
        await click('Download support report')
        expect(exportReport).toHaveBeenCalledTimes(1)
        expect(download).toHaveBeenCalledTimes(1)
        expect(createUrl).toHaveBeenCalledTimes(1)
        const blob = createUrl.mock.calls[0]![0] as Blob
        expect(JSON.parse(await blob.text())).toMatchObject({
            completeness: 'partial',
            unavailableSections: ['valkey'],
        })
        const feedback = [...dialog().querySelectorAll('output[aria-live="polite"]')].find((item) =>
            item.textContent?.includes('Partial report download started'),
        )
        expect(feedback).toBeDefined()
        expect(feedback!.closest('.sr-only, [hidden], [aria-hidden="true"]')).toBeNull()
        expect(document.querySelector('button[data-severity]')).toBeNull()
        expect(button('Download support report').disabled).toBe(false)
    } finally {
        createUrl.mockRestore()
        download.mockRestore()
    }
})

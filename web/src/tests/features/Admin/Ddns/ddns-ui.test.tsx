// oxlint-disable no-map-spread -- Immutable fixture snapshots model live server updates.
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import { toast } from '@rentnerkev/toasts/toast'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { DDNS_QUERY_KEYS } from '@/config/ddns.config.ts'
import { createDdnsDemoApi } from '@/features/Admin/Ddns/Development/ddns-demo.ts'
import type { DdnsApi } from '@/features/Admin/Ddns/Types/ddns-ui.types.ts'
import {
    DDNS_CONNECTION,
    ddnsBatch,
    ddnsSettings,
    ddnsSnapshot,
    ddnsTarget,
} from '@/tests/Helpers/ddnsFixture.ts'
import withTestLanguage, { catalogs } from '@/tests/Helpers/withTestLanguage.tsx'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: DdnsPage } = await import('@/features/Admin/Ddns/index.tsx')
const { default: DdnsDevelopment } = await import('@/features/Admin/Ddns/Development/index.tsx')
let root: Root | undefined
let client: InstanceType<typeof QueryClient>
const feedback: { kind: string; message: unknown }[] = []
let restoreToasts: (() => void)[] = []
beforeEach(() => {
    feedback.length = 0
    restoreToasts = (['error', 'success', 'info', 'warning'] as const).map((kind) => {
        const spy = spyOn(toast, kind).mockImplementation((message) => {
            feedback.push({ kind, message })
            return 'fixture-toast'
        })
        return () => spy.mockRestore()
    })
})
afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    client?.clear()
    document.body.replaceChildren()
    restoreToasts.forEach((restore) => restore())
})
const approved = ddnsSettings([
    ddnsTarget({ selection: { mode: 'adopt', recordId: 'c'.repeat(32) } }),
])
function translationKeys(value: object, prefix = ''): string[] {
    return Object.entries(value).flatMap(([key, child]) =>
        typeof child === 'object'
            ? translationKeys(child, `${prefix}${key}.`)
            : [`${prefix}${key}`],
    )
}
function fixture(initial = ddnsSnapshot()) {
    let snapshot = initial
    let unavailable = false
    const api: DdnsApi = {
        status: mock(async () => {
            if (unavailable) throw new Error('offline')
            return snapshot
        }),
        connections: mock(async () => [DDNS_CONNECTION]),
        apply: mock(async (input: Parameters<DdnsApi['apply']>[0]) => {
            snapshot = ddnsSnapshot(input.draft, input.enabled, input.expectedRevision + 1)
            return { success: true as const, value: snapshot }
        }),
        preview: mock(async () => ({
            success: true as const,
            value: {
                batch: ddnsBatch(approved),
                receipt: 'fixture',
                expiresAt: Date.now() + 180000,
            },
        })),
        save: mock(async () => ({ success: true as const, value: snapshot })),
        enable: mock(async () => ({ success: true as const, value: snapshot })),
        disable: mock(async (input: Parameters<DdnsApi['disable']>[0]) => {
            snapshot = ddnsSnapshot(
                snapshot.configuration!.settings,
                false,
                input.expectedRevision + 1,
            )
            return { success: true as const, value: snapshot }
        }),
        sync: mock(async () => ({
            success: true as const,
            value: {
                ...ddnsBatch(approved),
                preview: false,
                targets: ddnsBatch(approved).targets.map((target) => ({
                    ...target,
                    status: 'updated' as const,
                })),
            },
        })),
    }
    return {
        api,
        setUnavailable: (value: boolean) => {
            unavailable = value
        },
    }
}
async function waitFor(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 2000
    async function poll(): Promise<void> {
        if (condition()) return
        if (Date.now() > deadline)
            throw new Error(`DDNS UI timeout: ${document.body.textContent?.slice(-600)}`)
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
        await poll()
    }
    await poll()
}
async function render(api: DdnsApi, manage = true, development = false) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
        root!.render(
            withTestLanguage(
                <QueryClientProvider client={client}>
                    {development ? (
                        <DdnsDevelopment
                            api={api}
                            liveEnabled={false}
                            permissions={[
                                PERMISSIONS.DDNS_VIEW,
                                ...(manage
                                    ? [PERMISSIONS.DDNS_MANAGE, PERMISSIONS.DNS_CONNECTIONS_VIEW]
                                    : []),
                            ]}
                        />
                    ) : (
                        <DdnsPage
                            api={api}
                            liveEnabled={false}
                            permissions={[
                                PERMISSIONS.DDNS_VIEW,
                                ...(manage
                                    ? [PERMISSIONS.DDNS_MANAGE, PERMISSIONS.DNS_CONNECTIONS_VIEW]
                                    : []),
                            ]}
                        />
                    )}
                </QueryClientProvider>,
            ),
        ),
    )
    await waitFor(() => !document.body.textContent?.includes('Loading DDNS configuration'))
}
function button(label: string, scope: ParentNode = document) {
    const result = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent?.trim() === label,
    )
    if (!result) throw new Error(`Missing button: ${label}`)
    return result
}
async function click(element: Element) {
    await act(async () =>
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    )
}
async function fill(name: string, value: string) {
    const element = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
            element,
            value,
        )
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
    })
}
async function submit() {
    await act(async () =>
        document
            .querySelector('form')!
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
}
async function select(index: number, label: string) {
    await click(
        document.querySelector('[role="dialog"]')!.querySelectorAll('[role="combobox"]')[index]!,
    )
    await waitFor(() =>
        [...document.querySelectorAll('[role="option"]')].some((item) =>
            item.textContent?.includes(label),
        ),
    )
    await click(
        [...document.querySelectorAll('[role="option"]')].find((item) =>
            item.textContent?.includes(label),
        )!,
    )
}
async function action(label: string) {
    const trigger = document.querySelector('button[aria-label="Actions for example.com (A)"]')!
    await act(async () =>
        trigger.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
        ),
    )
    await waitFor(() => !!document.querySelector('[role="menuitem"]'))
    await click(
        [...document.querySelectorAll('[role="menuitem"]')].find(
            (item) => item.textContent?.trim() === label,
        )!,
    )
}
describe('DDNS administration UI', () => {
    test('AAAA creation follows the record type without a second global address switch', async () => {
        const { api } = fixture()
        await render(api)
        await click(button('Add records'))
        await select(0, 'Fixture Cloudflare')
        await select(2, 'IPv6 · AAAA records')
        await fill('domain-0', 'v6.example.com')
        await submit()
        await waitFor(() => !!feedback.find((item) => item.kind === 'success'))
        expect(api.apply).toHaveBeenCalledWith(
            expect.objectContaining({
                draft: expect.objectContaining({
                    ipv4: false,
                    ipv6: true,
                    targets: [
                        expect.objectContaining({
                            name: 'v6.example.com',
                            recordType: 'AAAA',
                            enabled: true,
                        }),
                    ],
                }),
            }),
        )
    })

    test('schedule settings are compact and contain only global timing options', async () => {
        await render(fixture(ddnsSnapshot(approved, true)).api)
        expect(button('Status details').getAttribute('aria-expanded')).toBe('false')
        await click(button('Status details'))
        expect(button('Status details').getAttribute('aria-expanded')).toBe('true')
        expect(document.querySelector('#ddns-runtime-details')).not.toBeNull()
        await click(button('Schedule'))
        expect(document.querySelector('input[name="intervalSeconds"]')).not.toBeNull()
        expect(document.querySelector('input[name="updateOnStart"]')).not.toBeNull()
        expect(document.querySelector('input[name="ipv4"]')).toBeNull()
        expect(document.querySelector('input[name="ipv6"]')).toBeNull()
        await fill('intervalSeconds', '600')
        await submit()
        await waitFor(() => !!feedback.find((item) => item.kind === 'success'))
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })

    test('column filter row can filter by proxy and reset without losing records', async () => {
        await render(createDdnsDemoApi())
        const filter = document.querySelector('button[aria-label="Filters"]')!
        expect(filter.getAttribute('aria-expanded')).toBe('false')
        await click(filter)
        expect(filter.getAttribute('aria-expanded')).toBe('true')
        const selects = [...document.querySelectorAll('[role="combobox"]')]
        await click(selects[1]!)
        await waitFor(
            () =>
                !![...document.querySelectorAll('[role="option"]')].find((item) =>
                    item.textContent?.includes('DNS only'),
                ),
        )
        await click(
            [...document.querySelectorAll('[role="option"]')].find((item) =>
                item.textContent?.includes('DNS only'),
            )!,
        )
        await waitFor(() => document.querySelectorAll('tbody tr').length === 4)
        expect(document.querySelector('tbody')!.textContent).toContain('git.example.com')
        expect(document.querySelector('tbody')!.textContent).not.toContain('cloud.example.com')
        await click(button('Reset filters'))
        await waitFor(() => document.querySelectorAll('tbody tr').length === 10)
    })

    test('development demo uses a separate cache and never sends a real mutation', async () => {
        const { api } = fixture(ddnsSnapshot(approved, true))
        await render(api, true, true)
        await click(button('Show demo data'))
        await waitFor(
            () => !!document.querySelector('button[aria-label="Actions for git.example.com (A)"]'),
        )
        await action('Disable')
        await waitFor(() => !!feedback.find((item) => item.message === 'Record disabled.'))
        expect(api.apply).not.toHaveBeenCalled()
        expect(client.getQueryData<typeof approved>(DDNS_QUERY_KEYS.status)).toMatchObject({
            configuration: { revision: 1 },
        })
        await click(button('Reset demo data'))
        await waitFor(
            () => !!document.querySelector('button[aria-label="Actions for example.com (A)"]'),
        )
        await click(button('Show real data'))
        await waitFor(() => !document.body.textContent?.includes('git.example.com'))
        expect(client.getQueryData(DDNS_QUERY_KEYS.status)).toMatchObject({
            configuration: { revision: 1 },
        })
        expect(api.disable).not.toHaveBeenCalled()
        expect(api.sync).not.toHaveBeenCalled()
    })
    test('a delayed mutation response cannot overwrite a newer committed configuration', async () => {
        const { api } = fixture(ddnsSnapshot(approved, true))
        const result = Promise.withResolvers<Awaited<ReturnType<DdnsApi['apply']>>>()
        api.apply = mock(() => result.promise)
        await render(api)
        await action('Disable')
        const newer = ddnsSnapshot(approved, true, 3)
        await act(async () => client.setQueryData(DDNS_QUERY_KEYS.status, newer))
        const own = ddnsSnapshot(
            ddnsSettings([{ ...approved.targets[0]!, enabled: false }]),
            true,
            2,
        )
        await act(async () => result.resolve({ success: true, value: own }))
        await waitFor(() => feedback.some((entry) => entry.kind === 'success'))
        expect(
            client.getQueryData<typeof newer>(DDNS_QUERY_KEYS.status)?.configuration?.revision,
        ).toBe(3)
        expect(
            client.getQueryData<typeof newer>(DDNS_QUERY_KEYS.status)?.configuration?.settings
                .targets[0]?.enabled,
        ).toBe(true)
    })
    test('manual update is unavailable when every saved record is disabled', async () => {
        const { api } = fixture(
            ddnsSnapshot(ddnsSettings([{ ...approved.targets[0]!, enabled: false }]), true),
        )
        await render(api)
        expect(button('Update now').disabled).toBe(true)
        expect(api.sync).not.toHaveBeenCalled()
    })
    test('saving a record while a restored configuration is paused never implicitly resumes DNS writes', async () => {
        const state = ddnsSnapshot(approved)
        state.restorePaused = true
        const { api } = fixture(state)
        await render(api)
        await action('Edit')
        await click(document.querySelector('input[name="proxied"]')!)
        await submit()
        await waitFor(() => !document.querySelector('form'))
        expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
        expect(api.enable).not.toHaveBeenCalled()
    })
    test('repeated form submissions admit only one pending configuration write', async () => {
        const { api } = fixture(ddnsSnapshot(approved, true))
        const result = Promise.withResolvers<Awaited<ReturnType<DdnsApi['apply']>>>()
        api.apply = mock(() => result.promise)
        await render(api)
        await action('Edit')
        await submit()
        await submit()
        expect(api.apply).toHaveBeenCalledTimes(1)
        expect(button('Working…').disabled).toBe(true)
        expect(button('Cancel').disabled).toBe(true)
        await act(async () =>
            result.resolve({ success: true, value: ddnsSnapshot(approved, true, 2) }),
        )
        await waitFor(() => !document.querySelector('form'))
    })
    test('an older in-flight status response cannot replace a successfully saved revision', async () => {
        const initial = ddnsSnapshot(approved, true)
        const { api } = fixture(initial)
        const delayed = Promise.withResolvers<typeof initial>()
        let reads = 0
        api.status = mock(async () => (++reads === 1 ? initial : delayed.promise))
        await render(api)
        await act(async () => {
            void client.invalidateQueries({ queryKey: DDNS_QUERY_KEYS.status })
        })
        await waitFor(() => reads === 2)
        await action('Disable')
        await waitFor(() => feedback.some((entry) => entry.kind === 'success'))
        await act(async () => delayed.resolve(initial))
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20))
        })
        expect(
            client.getQueryData<typeof initial>(DDNS_QUERY_KEYS.status)?.configuration?.revision,
        ).toBe(2)
        expect(document.body.textContent).toContain('Record disabled')
    })
    test('delete confirmation cannot silently adopt a revision changed by another administrator', async () => {
        const { api } = fixture(ddnsSnapshot(approved, true))
        await render(api)
        await action('Delete')
        await act(async () =>
            client.setQueryData(DDNS_QUERY_KEYS.status, ddnsSnapshot(approved, true, 2)),
        )
        await click(button('Delete', document.querySelector('[role="dialog"]')!))
        expect(api.apply).not.toHaveBeenCalled()
        expect(feedback.some((entry) => entry.kind === 'info')).toBe(true)
    })
    test('Enter can return to an existing empty domain input repeatedly', async () => {
        const { api } = fixture()
        await render(api)
        await click(button('Add records'))
        await fill('domain-0', 'home.example.com')
        const first = document.querySelector<HTMLInputElement>('input[name="domain-0"]')!
        await act(async () =>
            first.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
            ),
        )
        const second = document.querySelector<HTMLInputElement>('input[name="domain-1"]')!
        expect(document.activeElement?.getAttribute('name')).toBe(second.name)
        await act(async () => {
            first.focus()
            first.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
            )
        })
        expect(document.activeElement?.getAttribute('name')).toBe(second.name)
        expect(document.querySelectorAll('input[name^="domain-"]')).toHaveLength(2)
    })
    test('read-only table never fetches connection choices or exposes writes', async () => {
        const { api } = fixture(ddnsSnapshot(approved, true))
        await render(api, false)
        expect(document.body.textContent).toContain('example.com')
        expect(document.querySelector('table')).not.toBeNull()
        expect(document.querySelector('button[aria-label^="Actions for"]')).toBeNull()
        expect(document.body.textContent).not.toContain('Add records')
        expect(api.connections).not.toHaveBeenCalled()
    })
    test('Enter adds individual domains, automatic zone stays selected and save publishes the list directly', async () => {
        const { api } = fixture()
        await render(api)
        await click(button('Add records'))
        await select(0, 'Fixture Cloudflare')
        expect(
            document.querySelector('[role="dialog"]')!.querySelectorAll('[role="combobox"]')[1]
                ?.textContent,
        ).toContain('Match permitted zones automatically')
        await select(1, 'example.com')
        await select(1, 'Match permitted zones automatically')
        expect(
            document.querySelector('[role="dialog"]')!.querySelectorAll('[role="combobox"]')[1]
                ?.textContent,
        ).toContain('Match permitted zones automatically')
        await fill('domain-0', 'example.com')
        await act(async () =>
            document
                .querySelector('input[name="domain-0"]')!
                .dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
                ),
        )
        await fill('domain-1', '*.example.org')
        await submit()
        await waitFor(() => !document.querySelector('form'))
        expect(api.apply).toHaveBeenCalledWith(
            expect.objectContaining({
                enabled: true,
                draft: expect.objectContaining({
                    targets: expect.arrayContaining([
                        expect.objectContaining({ name: 'example.com', zoneId: 'a'.repeat(32) }),
                        expect.objectContaining({ name: '*.example.org', zoneId: 'b'.repeat(32) }),
                    ]),
                }),
            }),
        )
        expect(document.querySelectorAll('tbody tr')).toHaveLength(2)
        expect(api.preview).not.toHaveBeenCalled()
        expect(api.save).not.toHaveBeenCalled()
        expect(api.enable).not.toHaveBeenCalled()
        expect(feedback).toContainEqual({ kind: 'success', message: 'Records saved.' })
        for (const removed of [
            'Refresh status',
            'Preview changes',
            'Review ·',
            'Inspection required',
            'A fresh preview',
            'Port forwarding',
        ])
            expect(document.body.textContent).not.toContain(removed)
    })
    test('table actions persist edits, per-record disable/enable and confirmed removal', async () => {
        const { api } = fixture(ddnsSnapshot(approved, true))
        await render(api)
        await action('Edit')
        await click(document.querySelector('input[name="proxied"]')!)
        await submit()
        await waitFor(() => !document.querySelector('form'))
        expect(api.apply).toHaveBeenLastCalledWith(
            expect.objectContaining({
                enabled: true,
                draft: expect.objectContaining({
                    targets: [
                        expect.objectContaining({ proxied: false, id: approved.targets[0]!.id }),
                    ],
                }),
            }),
        )
        await action('Disable')
        await waitFor(() => !!document.body.textContent?.includes('Record disabled'))
        expect(api.apply).toHaveBeenLastCalledWith(
            expect.objectContaining({
                enabled: true,
                draft: expect.objectContaining({
                    targets: [expect.objectContaining({ enabled: false })],
                }),
            }),
        )
        await action('Enable')
        await waitFor(() => (api.apply as ReturnType<typeof mock>).mock.calls.length === 3)
        expect(api.apply).toHaveBeenLastCalledWith(
            expect.objectContaining({
                enabled: true,
                draft: expect.objectContaining({
                    targets: [expect.objectContaining({ enabled: true })],
                }),
            }),
        )
        await action('Delete')
        expect(api.apply).toHaveBeenCalledTimes(3)
        await click(button('Delete', document.querySelector('[role="dialog"]')!))
        await waitFor(() => (api.apply as ReturnType<typeof mock>).mock.calls.length === 4)
        expect(api.apply).toHaveBeenLastCalledWith(
            expect.objectContaining({
                enabled: false,
                draft: expect.objectContaining({ targets: [] }),
            }),
        )
    })
    test('live changes preserve the open draft and block stale saving with an info toast', async () => {
        const { api } = fixture(ddnsSnapshot(approved, true))
        await render(api)
        await action('Edit')
        await fill('domain-0', 'draft.example.com')
        await act(async () =>
            client.setQueryData(DDNS_QUERY_KEYS.status, ddnsSnapshot(approved, true, 2)),
        )
        await waitFor(() => button('Save changes').disabled)
        expect(document.querySelector<HTMLInputElement>('input[name="domain-0"]')?.value).toBe(
            'draft.example.com',
        )
        expect(feedback.some((item) => item.kind === 'info')).toBe(true)
        expect(api.apply).not.toHaveBeenCalled()
    })
    test('validation and rejected saves use toasts and retain the draft', async () => {
        const { api } = fixture(ddnsSnapshot(approved, true))
        api.apply = mock(async () => ({
            success: false as const,
            message: 'admin.ddns.recordErrors.record_conflict',
        }))
        await render(api)
        await action('Edit')
        await fill('domain-0', 'https://bad')
        await submit()
        expect(api.apply).not.toHaveBeenCalled()
        expect(feedback.some((item) => item.kind === 'error')).toBe(true)
        await fill('domain-0', 'example.com')
        await submit()
        await waitFor(() => (api.apply as ReturnType<typeof mock>).mock.calls.length === 1)
        expect(document.querySelector('form')).not.toBeNull()
        expect(document.querySelector('[role="alert"]')).toBeNull()
        expect(feedback.some((item) => String(item.message).includes('Multiple records'))).toBe(
            true,
        )
    })
    test('partial update uses warning toast and retains last good IP', async () => {
        const state = ddnsSnapshot(approved, true)
        state.targets[0]!.lastSuccessfulAddress = '203.0.113.5'
        state.targets[0]!.lastResult = {
            ...ddnsBatch(approved).targets[0]!,
            status: 'failed',
            error: 'provider_unauthorized',
        }
        const { api } = fixture(state)
        api.sync = mock(async () => ({
            success: true as const,
            value: {
                ...ddnsBatch(approved),
                preview: false,
                targets: [state.targets[0]!.lastResult!],
            },
        }))
        await render(api)
        await click(button('Update now'))
        expect(
            feedback.some(
                (item) =>
                    item.kind === 'warning' && String(item.message).includes('Update incomplete'),
            ),
        ).toBe(true)
        expect(document.body.textContent).toContain('203.0.113.5')
    })
    test('can pause an admitted run and recovers failed status through cache invalidation', async () => {
        const state = ddnsSnapshot(approved, true)
        state.inFlight = {
            startedAt: 1792205000,
            actorUserId: state.configuration!.updatedByUserId,
            trigger: 'scheduled',
            targetIds: [approved.targets[0]!.id],
        }
        const { api } = fixture(state)
        await render(api)
        expect(button('Update now').disabled).toBe(true)
        expect(button('Pause DDNS').disabled).toBe(false)
        await click(button('Pause DDNS'))
        expect(api.disable).toHaveBeenCalledTimes(1)
    })
    test('failed live refetch keeps known records, blocks writes and recovers without reload controls', async () => {
        const { api, setUnavailable } = fixture(ddnsSnapshot(approved, true))
        await render(api)
        setUnavailable(true)
        await act(async () => {
            await client.invalidateQueries({ queryKey: DDNS_QUERY_KEYS.status })
        })
        await waitFor(() => button('Update now').disabled)
        expect(document.body.textContent).toContain('example.com')
        expect(feedback.some((item) => item.kind === 'error')).toBe(true)
        setUnavailable(false)
        await act(async () => {
            await client.invalidateQueries({ queryKey: DDNS_QUERY_KEYS.status })
        })
        await waitFor(() => !button('Update now').disabled)
    })
    test('all languages contain the complete journey', () => {
        const expected = translationKeys(catalogs.en.admin.ddns)
        for (const catalog of Object.values(catalogs))
            expect(translationKeys(catalog.admin.ddns)).toEqual(expected)
    })
})

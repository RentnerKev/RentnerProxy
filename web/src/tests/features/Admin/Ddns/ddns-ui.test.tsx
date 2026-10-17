// oxlint-disable no-map-spread -- Fixtures retain immutable snapshots for query refresh assertions.
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { DDNS_QUERY_KEYS } from '@/config/ddns.config.ts'
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
let root: Root | undefined
let client: InstanceType<typeof QueryClient>
afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    client?.clear()
    document.body.replaceChildren()
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
        preview: mock(async (input: Parameters<DdnsApi['preview']>[0]) => {
            const batch = ddnsBatch(input.draft)
            return {
                success: true as const,
                value: {
                    batch,
                    receipt: batch.targets.some((target) => target.error)
                        ? null
                        : 'fixture-receipt',
                    expiresAt: Date.now() + 180000,
                },
            }
        }),
        save: mock(async (input: Parameters<DdnsApi['save']>[0]) => {
            snapshot = ddnsSnapshot(input.draft, false, input.expectedRevision + 1)
            return { success: true as const, value: snapshot }
        }),
        enable: mock(async (input: Parameters<DdnsApi['enable']>[0]) => {
            snapshot = ddnsSnapshot(
                snapshot.configuration!.settings,
                true,
                input.expectedRevision + 1,
            )
            return { success: true as const, value: snapshot }
        }),
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
        setUnavailable: (next: boolean) => {
            unavailable = next
        },
        setSnapshot: (next: typeof snapshot) => {
            snapshot = next
        },
    }
}
async function render(api: DdnsApi, manage = true) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
        root!.render(
            withTestLanguage(
                <QueryClientProvider client={client}>
                    <DdnsPage
                        api={api}
                        permissions={[
                            PERMISSIONS.DDNS_VIEW,
                            ...(manage
                                ? [PERMISSIONS.DDNS_MANAGE, PERMISSIONS.DNS_CONNECTIONS_VIEW]
                                : []),
                        ]}
                    />
                </QueryClientProvider>,
            ),
        ),
    )
    await waitFor(() => !document.body.textContent?.includes('Loading DDNS configuration'))
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
async function fillDomains(value: string) {
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[name="domains"]')!
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
            textarea,
            value,
        )
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        textarea.dispatchEvent(new Event('change', { bubbles: true }))
    })
}
async function confirm(label: string) {
    await waitFor(() => !!document.querySelector('[role="dialog"]'))
    await click(button(label, document.querySelector('[role="dialog"]')!))
}

describe('DDNS administration UI', () => {
    test('read-only status never fetches connection choices or exposes mutation actions', async () => {
        const { api } = fixture(ddnsSnapshot(approved, true))
        await render(api, false)
        expect(document.body.textContent).toContain('Read only')
        expect(document.body.textContent).toContain('example.com')
        expect(document.body.textContent).not.toContain('Edit configuration')
        expect(api.connections).not.toHaveBeenCalled()
        expect(api.preview).not.toHaveBeenCalled()
    })
    test('completes multi-zone wildcard selection, explicit adoption, paused save and separate activation', async () => {
        const { api } = fixture()
        await render(api)
        await click(button('Configure DDNS'))
        const selects = document.querySelectorAll('[role="combobox"]')
        expect(selects.length).toBe(2)
        await waitFor(() => !(selects[0] as HTMLButtonElement).disabled)
        await click(selects[0]!)
        await waitFor(() => !!document.querySelector('[role="option"]'))
        await click(
            [...document.querySelectorAll('[role="option"]')].find((option) =>
                option.textContent?.includes('Fixture Cloudflare'),
            )!,
        )
        await fillDomains('example.com, *.example.com, example.org, *.example.org, git.example.com')
        await click(button('Add to record list'))
        expect(document.querySelectorAll('li').length).toBe(5)
        const proxy = document.querySelector<HTMLInputElement>(
            'input[aria-label="Cloudflare proxy for git.example.com (A)"]',
        )!
        await click(proxy)
        await click(button('Preview changes'))
        await waitFor(
            () => !!document.body.textContent?.includes('Existing record · approval required'),
        )
        expect(api.save).not.toHaveBeenCalled()
        await click(button('Approve inspected records'))
        await waitFor(() => !button('Save paused').disabled)
        expect(api.preview).toHaveBeenCalledTimes(2)
        await click(button('Save paused'))
        expect(api.save).not.toHaveBeenCalled()
        await confirm('Save paused')
        await waitFor(() => !!document.body.textContent?.includes('Saved paused.'))
        expect(api.enable).not.toHaveBeenCalled()
        expect(api.save).toHaveBeenCalledWith(
            expect.objectContaining({
                draft: expect.objectContaining({
                    intervalSeconds: 300,
                    ipv4: true,
                    ipv6: false,
                    updateOnStart: true,
                    targets: expect.arrayContaining([
                        expect.objectContaining({ name: 'git.example.com', proxied: false }),
                    ]),
                }),
            }),
        )
        expect(button('Enable DDNS').disabled).toBe(true)
        await click(button('Preview changes'))
        await waitFor(() => !button('Enable DDNS').disabled)
        await click(button('Enable DDNS'))
        expect(api.enable).not.toHaveBeenCalled()
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
            'stopped any previous DDNS updater',
        )
        await confirm('Enable approved records')
        await waitFor(() => !!document.body.textContent?.includes('DDNS enabled.'))
        expect(api.enable).toHaveBeenCalledTimes(1)
        expect(document.body.textContent).not.toContain('test.example.com (A)')
        await click(button('Update now'))
        await waitFor(() => !!document.body.textContent?.includes('Update completed.'))
    })
    test('editing a proxy flag invalidates the prior preview without losing the draft', async () => {
        const { api } = fixture(ddnsSnapshot(approved))
        await render(api)
        await click(button('Edit configuration'))
        await click(button('Preview changes'))
        await waitFor(() => !button('Save paused').disabled)
        await click(
            document.querySelector('input[aria-label="Cloudflare proxy for example.com (A)"]')!,
        )
        expect(button('Save paused').disabled).toBe(true)
        expect(document.body.textContent).toContain('A fresh preview is required')
        expect(api.save).not.toHaveBeenCalled()
    })
    test('background configuration changes keep the draft and block stale save', async () => {
        const { api } = fixture(ddnsSnapshot(approved))
        await render(api)
        await click(button('Edit configuration'))
        await act(async () =>
            client.setQueryData(DDNS_QUERY_KEYS.status, ddnsSnapshot(approved, false, 2)),
        )
        await waitFor(
            () => !!document.body.textContent?.includes('Configuration changed elsewhere'),
        )
        expect(button('Preview changes').disabled).toBe(true)
        expect(document.querySelectorAll('li').length).toBe(1)
        expect(api.save).not.toHaveBeenCalled()
    })
    test('provider partial failure keeps last good IP and renders a specific error', async () => {
        const state = ddnsSnapshot(approved, true)
        state.targets[0] = {
            ...state.targets[0]!,
            lastSuccessfulAddress: '203.0.113.5',
            lastSuccessAt: 1_792_205_000,
            lastResult: {
                ...ddnsBatch(approved).targets[0]!,
                status: 'failed',
                error: 'provider_unauthorized',
            },
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
        await waitFor(() => !!document.body.textContent?.includes('Update incomplete'))
        expect(document.body.textContent).toContain('203.0.113.5')
        expect(document.body.textContent).toContain('Cloudflare denied access')
    })
    test('can pause while a previously admitted controller batch finishes', async () => {
        const state = ddnsSnapshot(approved, true)
        state.inFlight = {
            startedAt: 1_792_205_000,
            actorUserId: state.configuration!.updatedByUserId,
            trigger: 'scheduled',
            targetIds: [approved.targets[0]!.id],
        }
        const { api } = fixture(state)
        await render(api)
        expect(button('Update now').disabled).toBe(true)
        expect(button('Pause DDNS').disabled).toBe(false)
        await click(button('Pause DDNS'))
        await confirm('Pause updates')
        await waitFor(() => !!document.body.textContent?.includes('DDNS paused.'))
        expect(api.disable).toHaveBeenCalledTimes(1)
    })
    test('unavailable refresh keeps known values and blocks mutations until recovery', async () => {
        const { api, setUnavailable } = fixture(ddnsSnapshot(approved, true))
        await render(api)
        setUnavailable(true)
        await click(button('Refresh status'))
        await waitFor(() => !!document.body.textContent?.includes('Controller unavailable'))
        expect(document.body.textContent).toContain('example.com')
        expect(button('Update now').disabled).toBe(true)
        expect(button('Edit configuration').disabled).toBe(true)
        expect(api.sync).not.toHaveBeenCalled()
        setUnavailable(false)
        await click(button('Refresh status'))
        await waitFor(() => !button('Update now').disabled)
    })
    test('does not report rate-limited skipped records as an unchanged success', async () => {
        const { api } = fixture(ddnsSnapshot(approved, true))
        api.sync = mock(async () => ({
            success: true as const,
            value: {
                ...ddnsBatch(approved),
                preview: false,
                targets: [
                    {
                        ...ddnsBatch(approved).targets[0]!,
                        status: 'skipped' as const,
                        error: 'provider_rate_limited' as const,
                        retryAfterSeconds: 30,
                    },
                ],
            },
        }))
        await render(api)
        await click(button('Update now'))
        await waitFor(() => !!document.body.textContent?.includes('Update incomplete'))
        expect(document.body.textContent).not.toContain(
            'All attempted records were already up to date',
        )
    })
    test('all languages contain the complete DDNS journey and actionable error messages', () => {
        const expected = translationKeys(catalogs.en.admin.ddns)
        for (const catalog of Object.values(catalogs))
            expect(translationKeys(catalog.admin.ddns)).toEqual(expected)
    })
})

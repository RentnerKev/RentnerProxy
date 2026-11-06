import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type { OidcConnectionsLogicResult } from '@/features/UserSettings/Components/OidcConnectionsPanel/Types/oidc-connections.types.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const navigate = mock(async () => {})
const invalidate = mock(async () => {})
const success = mock(() => '')
const error = mock(() => '')
const translate = (key: string) => key
let feedback: Record<string, string> = {}
mock.module('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    useRouter: () => ({ invalidate }),
    useSearch: () => feedback,
}))
mock.module('@rentnerkev/toasts', () => ({ toast: { success, error } }))
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ t: translate }),
}))
const { default: Panel } =
    await import('@/features/UserSettings/Components/OidcConnectionsPanel/index.tsx')
const { default: useOidcConnectionsLogic } =
    await import('@/features/UserSettings/Components/OidcConnectionsPanel/Hooks/useOidcConnectionsLogic.ts')
function LogicHarness({ onChange }: { onChange: (logic: OidcConnectionsLogicResult) => void }) {
    const logic = useOidcConnectionsLogic('user-one', true)
    useEffect(() => {
        onChange(logic)
    }, [logic, onChange])
    return null
}
const providerId = '6d5716ab-a988-4d8b-9855-02acefffb72e'
const connections = (linked = false, enabled = true, externallyManaged = false) => ({
    revision: 7,
    externallyManaged,
    providers: [{ id: providerId, name: 'Example ID', linked, enabled }],
})
let root: Root | null = null
let client: InstanceType<typeof QueryClient> | null = null
let container: HTMLDivElement
const fetchMock = spyOn(globalThis, 'fetch')
const submit = spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
const stopNavigation = mock(() => {})
Object.defineProperty(window, 'stop', { configurable: true, writable: true, value: stopNavigation })

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15))
    })
}
async function render(
    canUpdate = true,
    onLogicChange?: (logic: OidcConnectionsLogicResult) => void,
) {
    container = document.createElement('div')
    document.body.append(container)
    client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
    root = createRoot(container)
    await act(async () => {
        root?.render(
            <QueryClientProvider client={client!}>
                {onLogicChange ? (
                    <LogicHarness onChange={onLogicChange} />
                ) : (
                    <Panel userId="user-one" canUpdate={canUpdate} />
                )}
            </QueryClientProvider>,
        )
    })
    await flush()
}
async function click(label: string, twice = false) {
    const button = [...container.querySelectorAll('button')].find(
        (item) => item.textContent === label,
    )
    expect(button).toBeDefined()
    await act(async () => {
        button!.click()
        if (twice) button!.click()
    })
    await flush()
}
afterEach(async () => {
    await act(async () => {
        root?.unmount()
    })
    root = null
    client?.clear()
    document.body.innerHTML = ''
    fetchMock.mockReset()
    submit.mockClear()
    stopNavigation.mockReset()
    stopNavigation.mockImplementation(() => {})
    navigate.mockClear()
    success.mockClear()
    error.mockClear()
    feedback = {}
})

describe('linked identity accounts', () => {
    test('automatically recovers a transient load and reflects subsequent live invalidation', async () => {
        fetchMock.mockRejectedValueOnce(new Error('offline')).mockImplementation(
            Object.assign(async () => Response.json(connections()), {
                preconnect: fetch.preconnect,
            }),
        )
        await render()
        await flush()
        expect(container.textContent).toContain('Example ID')
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(container.textContent).not.toContain('account.oidc.refresh')
        fetchMock.mockImplementation(
            Object.assign(async () => Response.json(connections(true)), {
                preconnect: fetch.preconnect,
            }),
        )
        await act(async () => {
            await client!.invalidateQueries({ queryKey: ['auth', 'account', 'oidc-connections'] })
        })
        await flush()
        expect(container.querySelector('[aria-label^="account.oidc.unlink:"]')).not.toBeNull()
    })

    test('submits exactly one same-origin native link form using the active session', async () => {
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.link', true)
        expect(container.querySelector('dialog')).toBeNull()
        expect(submit).toHaveBeenCalledTimes(1)
        const form = container.querySelector('form')!
        expect(form.getAttribute('action')).toBe('/api/auth/oidc/start')
        expect(form.method).toBe('post')
        expect(new FormData(form).get('providerId')).toBe(providerId)
        expect(new FormData(form).get('intent')).toBe('link')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    test('unlinks using the active session and displayed revision, then refreshes', async () => {
        fetchMock
            .mockResolvedValueOnce(Response.json(connections(true)))
            .mockResolvedValueOnce(Response.json({ success: true }))
            .mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.unlink')
        const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')
        expect(posts).toHaveLength(1)
        expect(JSON.parse(String(posts[0]![1]?.body))).toEqual({ providerId, expectedRevision: 7 })
        expect(success).toHaveBeenCalled()
        expect(container.textContent).not.toContain('account.oidc.unlinkedSuccess')
        expect(success).toHaveBeenCalledWith('account.oidc.unlinkedSuccess', {
            title: 'toast.titles.success',
        })
    })
    test('shows revision conflicts and refreshes without automatically retrying', async () => {
        fetchMock
            .mockResolvedValueOnce(Response.json(connections(true)))
            .mockResolvedValueOnce(
                Response.json({ error: 'configuration_conflict' }, { status: 409 }),
            )
            .mockResolvedValue(Response.json(connections(true)))
        await render()
        await click('account.oidc.unlink')
        expect(container.textContent).not.toContain('account.oidc.error.conflict')
        expect(error).toHaveBeenCalledWith('account.oidc.error.conflict', {
            title: 'toast.titles.error',
        })
        expect(
            fetchMock.mock.calls.filter((call) => call[1]?.method === 'GET').length,
        ).toBeGreaterThan(1)
        expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
    })
    test('keeps externally managed accounts read-only', async () => {
        fetchMock.mockResolvedValue(Response.json(connections(true, true, true)))
        await render()
        expect(container.textContent).toContain('account.oidc.external')
        expect(container.textContent).not.toContain('account.oidc.description')
        expect(
            container.querySelector<HTMLButtonElement>('[aria-label^="account.oidc.unlink"]')
                ?.disabled,
        ).toBe(true)
    })
    test('allows removing a disabled linked provider', async () => {
        fetchMock.mockResolvedValue(Response.json(connections(true, false)))
        await render()
        expect(container.textContent).toContain('account.oidc.disabled')
        expect(
            container.querySelector<HTMLButtonElement>('[aria-label^="account.oidc.unlink"]')
                ?.disabled,
        ).toBe(false)
    })
    test('does not fetch without account update permission', async () => {
        await render(false)
        expect(fetchMock).not.toHaveBeenCalled()
        expect(container.textContent).toContain('account.oidc.noPermission')
    })
    test('cancellation stops the active document request', async () => {
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.link')
        await click('account.oidc.cancel')
        expect(container.querySelector('dialog')).toBeNull()
        expect(submit).toHaveBeenCalledTimes(1)
        expect(stopNavigation).toHaveBeenCalledTimes(1)
    })
    test('rejects malformed raw responses', async () => {
        fetchMock.mockResolvedValue(Response.json({ ...connections(), externallyManaged: 'false' }))
        await render()
        expect(container.textContent).toContain('account.oidc.error.unavailable')
        expect(container.querySelector('[aria-label^="account.oidc.link:"]')).toBeNull()
    })
    test('clears user data and navigates to local login after session expiry', async () => {
        fetchMock.mockResolvedValue(
            Response.json({ error: 'authentication_required' }, { status: 401 }),
        )
        await render()
        expect(navigate).toHaveBeenCalledWith({ to: '/login', replace: true })
    })
    test('aborts a pending unlink and ignores its late response after navigating away', async () => {
        let finish: ((value: Response) => void) | undefined
        fetchMock.mockResolvedValueOnce(Response.json(connections(true))).mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve
            }),
        )
        await render()
        await click('account.oidc.unlink')
        const signal = fetchMock.mock.calls[1]?.[1]?.signal
        await act(async () => {
            root?.unmount()
            root = null
        })
        expect(signal?.aborted).toBe(true)
        await act(async () => {
            finish?.(Response.json({ success: true }))
        })
        await flush()
        expect(success).not.toHaveBeenCalled()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    test('back navigation clears the synchronous guard and refreshes provider state', async () => {
        fetchMock
            .mockResolvedValueOnce(Response.json(connections()))
            .mockResolvedValueOnce(Response.json(connections()))
        await render()
        await click('account.oidc.link')
        expect(submit).toHaveBeenCalledTimes(1)
        await act(async () => {
            const event = new Event('pageshow')
            Object.defineProperty(event, 'persisted', { value: true })
            window.dispatchEvent(event)
        })
        await flush()
        await click('account.oidc.link')
        expect(submit).toHaveBeenCalledTimes(2)
    })
    test('consumes allowlisted callback feedback once and removes it from navigation', async () => {
        feedback = { oidcResult: 'linked' }
        fetchMock.mockResolvedValue(Response.json(connections(true)))
        await render()
        expect(container.textContent).not.toContain('account.oidc.linkedSuccess')
        expect(success).toHaveBeenCalledWith('account.oidc.linkedSuccess', {
            title: 'toast.titles.success',
        })
        expect(success).toHaveBeenCalledTimes(1)
        expect(navigate).toHaveBeenCalledWith({
            to: '/account',
            search: { section: 'linked-accounts' },
            replace: true,
        })
    })
    test('reports a synchronous native form failure without leaving controls locked', async () => {
        submit.mockImplementationOnce(() => {
            throw new Error('private diagnostic')
        })
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.link')
        expect(container.textContent).not.toContain('account.oidc.error.failed')
        expect(error).toHaveBeenCalledWith('account.oidc.error.failed', {
            title: 'toast.titles.error',
        })
        expect(container.textContent).not.toContain('private diagnostic')
        expect(container.querySelector('dialog')).toBeNull()
        await click('account.oidc.link')
        expect(submit).toHaveBeenCalledTimes(2)
    })
    test('reports denied unlink without requesting another identity check', async () => {
        fetchMock
            .mockResolvedValueOnce(Response.json(connections(true)))
            .mockResolvedValueOnce(Response.json({ error: 'permission_denied' }, { status: 403 }))
        await render()
        await click('account.oidc.unlink')
        expect(error).toHaveBeenCalledTimes(1)
        expect(success).not.toHaveBeenCalled()
        expect(container.querySelector('dialog')).toBeNull()
    })
    test('redirects to login when the session expires during unlink', async () => {
        fetchMock
            .mockResolvedValueOnce(Response.json(connections(true)))
            .mockResolvedValueOnce(
                Response.json({ error: 'authentication_required' }, { status: 401 }),
            )
        await render()
        await click('account.oidc.unlink')
        expect(navigate).toHaveBeenCalledWith({ to: '/login', replace: true })
        expect(container.querySelector('dialog')).toBeNull()
    })
    test('does not offer linking to a disabled provider', async () => {
        fetchMock.mockResolvedValue(Response.json(connections(false, false)))
        await render()
        expect(
            container.querySelector<HTMLButtonElement>('[aria-label^="account.oidc.link:"]')
                ?.disabled,
        ).toBe(true)
    })
    test('waits for fresh connection state before confirming callback success', async () => {
        feedback = { oidcResult: 'linked' }
        let finish: ((value: Response) => void) | undefined
        fetchMock.mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve
            }),
        )
        await render()
        expect(success).not.toHaveBeenCalled()
        expect(navigate).not.toHaveBeenCalled()
        await act(async () => {
            finish?.(Response.json(connections(true)))
        })
        await flush()
        expect(success).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    test('does not announce a forged success marker without a linked account', async () => {
        feedback = { oidcResult: 'linked' }
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        expect(success).not.toHaveBeenCalled()
        expect(container.textContent).not.toContain('account.oidc.error.failed')
        expect(error).toHaveBeenCalledWith('account.oidc.error.failed', {
            title: 'toast.titles.error',
        })
        expect(error).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    test('does not announce callback success when the fresh state cannot be loaded', async () => {
        feedback = { oidcResult: 'linked' }
        fetchMock.mockResolvedValue(
            Response.json({ error: 'configuration_unavailable' }, { status: 503 }),
        )
        await render()
        expect(success).not.toHaveBeenCalled()
        expect(container.textContent).not.toContain('account.oidc.error.failed')
        expect(error).toHaveBeenCalledWith('account.oidc.error.failed', {
            title: 'toast.titles.error',
        })
        expect(error).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledTimes(4)
    })
    test('ordinary pageshow preserves active navigation and does not refresh', async () => {
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.link')
        await act(async () => {
            window.dispatchEvent(new Event('pageshow'))
        })
        expect(container.textContent).toContain('account.oidc.pending')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    test('stops native navigation when the panel unmounts', async () => {
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.link')
        await act(async () => {
            root?.unmount()
            root = null
        })
        expect(stopNavigation).toHaveBeenCalledTimes(1)
        expect(submit).toHaveBeenCalledTimes(1)
    })
    test('keeps navigation cancellation reachable and refreshes before a new action', async () => {
        let finishRefresh: ((response: Response) => void) | undefined
        fetchMock.mockResolvedValueOnce(Response.json(connections())).mockReturnValueOnce(
            new Promise((resolve) => {
                finishRefresh = resolve
            }),
        )
        await render()
        await click('account.oidc.link')
        const cancel = [...container.querySelectorAll('button')].find(
            (button) => button.textContent === 'account.oidc.cancel',
        )!
        expect(cancel.disabled).toBe(false)
        expect(cancel.closest('fieldset[disabled], [inert]')).toBeNull()
        expect(container.querySelector('dialog')).toBeNull()
        await click('account.oidc.cancel', true)
        expect(stopNavigation).toHaveBeenCalledTimes(1)
        expect(submit).toHaveBeenCalledTimes(1)
        expect(container.querySelector('dialog')).toBeNull()
        expect(container.textContent).not.toContain('account.oidc.pending')
        expect(
            container.querySelector<HTMLButtonElement>('[aria-label^="account.oidc.link:"]')
                ?.disabled,
        ).toBe(true)
        await act(async () => {
            finishRefresh?.(Response.json(connections()))
        })
        await flush()
        await click('account.oidc.link')
        expect(submit).toHaveBeenCalledTimes(2)
    })
    test('stops native navigation before releasing action guards and ignores stale cancellation', async () => {
        let current: OidcConnectionsLogicResult | undefined
        fetchMock
            .mockResolvedValueOnce(Response.json(connections()))
            .mockResolvedValueOnce(Response.json(connections()))
            .mockResolvedValueOnce(Response.json(connections()))
        await render(true, (logic) => {
            current = logic
        })
        const form = document.createElement('form')
        const input = document.createElement('input')
        input.name = 'providerId'
        form.append(input)
        current!.refs.form.current = form
        await act(async () => {
            current!.handler.handleRequest(providerId, 'link')
        })
        await act(async () => {})
        await flush()
        const staleCancel = current!.handler.handleCancelNavigation
        const activeHandlers = current!.handler
        stopNavigation.mockImplementationOnce(() => {
            activeHandlers.handleRequest(providerId, 'link')
            staleCancel()
        })
        await act(async () => {
            staleCancel()
            staleCancel()
        })
        await flush()
        expect(stopNavigation).toHaveBeenCalledTimes(1)
        expect(submit).toHaveBeenCalledTimes(1)
        expect(current!.state.action).toBeNull()
        expect(current!.state.isNavigating).toBe(false)
        await act(async () => {
            current!.handler.handleRequest(providerId, 'link')
        })
        await act(async () => {})
        await flush()
        await act(async () => {
            staleCancel()
        })
        expect(current!.state.isNavigating).toBe(true)
        expect(stopNavigation).toHaveBeenCalledTimes(1)
        await act(async () => {
            current!.handler.handleCancelNavigation()
            current!.handler.handleCancelNavigation()
        })
        await flush()
        expect(stopNavigation).toHaveBeenCalledTimes(2)
        expect(submit).toHaveBeenCalledTimes(2)
    })
})

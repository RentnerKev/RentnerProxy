import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type { ReauthenticationModalProps } from '@/features/UserSettings/Components/SecuritySettingsPanel/Types/reauthentication-modal.types.ts'
import type { OidcConnectionsLogicResult } from '@/features/UserSettings/Components/OidcConnectionsPanel/Types/oidc-connections.types.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const verify = mock(async () => ({ success: true, message: 'verified' }))
const beginPasskey = mock(async () => ({ success: true, challengeId: 'challenge', options: {} }))
const startAuthentication = mock(async () => ({}))
mock.module('@simplewebauthn/browser', () => ({ startAuthentication }))
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
mock.module(
    '@/features/UserSettings/Components/SecuritySettingsPanel/Hooks/useReauthentication.ts',
    () => ({
        default: () => ({
            state: { credential: 'password', isPending: false },
            setter: { setCredential: () => {} },
            handler: {
                reset: () => {},
                verifyPassword: verify,
                beginPasskey,
                finishPasskey: verify,
            },
        }),
    }),
)
mock.module(
    '@/features/UserSettings/Components/SecuritySettingsPanel/Components/ReauthenticationModal.tsx',
    () => ({
        default: (props: ReauthenticationModalProps) =>
            props.open ? (
                <dialog open>
                    <button onClick={props.onConfirm}>Confirm password</button>
                    <button onClick={props.onPasskey}>Confirm passkey</button>
                    <button onClick={props.onClose}>Cancel</button>
                </dialog>
            ) : null,
    }),
)
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
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
    verify.mockClear()
    beginPasskey.mockClear()
    startAuthentication.mockClear()
    navigate.mockClear()
    success.mockClear()
    error.mockClear()
    feedback = {}
})

describe('linked identity accounts', () => {
    test('requires local consent and submits exactly one same-origin native link form', async () => {
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.link', true)
        expect(submit).not.toHaveBeenCalled()
        expect(container.querySelector('dialog')).not.toBeNull()
        await click('Confirm password', true)
        expect(verify).toHaveBeenCalledTimes(1)
        expect(submit).toHaveBeenCalledTimes(1)
        const form = container.querySelector('form')!
        expect(form.getAttribute('action')).toBe('/api/auth/oidc/start')
        expect(form.method).toBe('post')
        expect(new FormData(form).get('providerId')).toBe(providerId)
        expect(new FormData(form).get('intent')).toBe('link')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    test('unlinks after fresh consent using the displayed revision and refreshes', async () => {
        fetchMock
            .mockResolvedValueOnce(Response.json(connections(true)))
            .mockResolvedValueOnce(Response.json({ success: true }))
            .mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.unlink')
        await click('Confirm password', true)
        const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')
        expect(posts).toHaveLength(1)
        expect(JSON.parse(String(posts[0]![1]?.body))).toEqual({ providerId, expectedRevision: 7 })
        expect(success).toHaveBeenCalled()
        expect(container.textContent).toContain('account.oidc.unlinkedSuccess')
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
        await click('Confirm password')
        expect(container.textContent).toContain('account.oidc.error.conflict')
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
    test('cancellation does not initiate an identity flow', async () => {
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.link')
        await click('Cancel')
        expect(container.querySelector('dialog')).toBeNull()
        expect(submit).not.toHaveBeenCalled()
        expect(verify).not.toHaveBeenCalled()
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
    test('does not continue a pending confirmation after navigating away', async () => {
        let finish: ((value: { success: boolean; message: string }) => void) | undefined
        verify.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve
                }),
        )
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.link')
        await click('Confirm password')
        await act(async () => {
            root?.unmount()
            root = null
        })
        await act(async () => {
            finish?.({ success: true, message: 'verified' })
            await Promise.resolve()
        })
        expect(submit).not.toHaveBeenCalled()
    })
    test('back navigation clears the synchronous guard and refreshes provider state', async () => {
        fetchMock
            .mockResolvedValueOnce(Response.json(connections()))
            .mockResolvedValueOnce(Response.json(connections()))
        await render()
        await click('account.oidc.link')
        await click('Confirm password')
        expect(submit).toHaveBeenCalledTimes(1)
        await act(async () => {
            const event = new Event('pageshow')
            Object.defineProperty(event, 'persisted', { value: true })
            window.dispatchEvent(event)
        })
        await flush()
        await click('account.oidc.link')
        await click('Confirm password')
        expect(submit).toHaveBeenCalledTimes(2)
    })
    test('consumes allowlisted callback feedback once and removes it from navigation', async () => {
        feedback = { oidcResult: 'linked' }
        fetchMock.mockResolvedValue(Response.json(connections(true)))
        await render()
        expect(container.textContent).toContain('account.oidc.linkedSuccess')
        expect(success).toHaveBeenCalledTimes(1)
        expect(navigate).toHaveBeenCalledWith({
            to: '/account',
            search: { section: 'linked-accounts' },
            replace: true,
        })
    })
    test('keeps failed fresh consent visible and does not start a link', async () => {
        verify.mockResolvedValueOnce({
            success: false,
            message: 'account.reauthentication.error.failed',
        })
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.link')
        await click('Confirm password')
        expect(container.textContent).toContain('account.reauthentication.error.failed')
        expect(submit).not.toHaveBeenCalled()
        expect(container.querySelector('dialog')).not.toBeNull()
    })
    test('links with fresh local passkey consent', async () => {
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.link')
        await click('Confirm passkey', true)
        expect(beginPasskey).toHaveBeenCalledTimes(1)
        expect(startAuthentication).toHaveBeenCalledTimes(1)
        expect(verify).toHaveBeenCalledTimes(1)
        expect(submit).toHaveBeenCalledTimes(1)
    })
    test('requires renewed consent when server freshness expires', async () => {
        fetchMock
            .mockResolvedValueOnce(Response.json(connections(true)))
            .mockResolvedValueOnce(
                Response.json({ error: 'reauthentication_required' }, { status: 403 }),
            )
        await render()
        await click('account.oidc.unlink')
        await click('Confirm password')
        expect(container.textContent).toContain('account.oidc.error.reauthenticate')
        expect(container.querySelector('dialog')).toBeNull()
        await click('account.oidc.unlink')
        expect(container.querySelector('dialog')).not.toBeNull()
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
        expect(container.textContent).toContain('account.oidc.error.failed')
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
        expect(container.textContent).toContain('account.oidc.error.failed')
        expect(error).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    test('ordinary pageshow preserves pending consent and does not refresh', async () => {
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.link')
        await act(async () => {
            window.dispatchEvent(new Event('pageshow'))
        })
        expect(container.querySelector('dialog')).not.toBeNull()
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    test('does not open a stale passkey prompt after navigating away', async () => {
        let finish:
            | ((value: { success: boolean; challengeId: string; options: object }) => void)
            | undefined
        beginPasskey.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve
                }),
        )
        fetchMock.mockResolvedValue(Response.json(connections()))
        await render()
        await click('account.oidc.link')
        await click('Confirm passkey')
        await act(async () => {
            root?.unmount()
            root = null
        })
        await act(async () => {
            finish?.({ success: true, challengeId: 'late', options: {} })
            await Promise.resolve()
        })
        expect(startAuthentication).not.toHaveBeenCalled()
        expect(submit).not.toHaveBeenCalled()
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
        await click('Confirm password')
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
        await click('Confirm password')
        expect(verify).toHaveBeenCalledTimes(2)
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
        current!.refs.form.current = form
        await act(async () => {
            current!.handler.handleRequest(providerId, 'link')
        })
        await act(async () => {
            current!.handler.handlePassword()
        })
        await flush()
        const staleCancel = current!.handler.handleCancelNavigation
        const activeHandlers = current!.handler
        stopNavigation.mockImplementationOnce(() => {
            activeHandlers.handleRequest(providerId, 'link')
            activeHandlers.handlePassword()
            staleCancel()
        })
        await act(async () => {
            staleCancel()
            staleCancel()
        })
        await flush()
        expect(stopNavigation).toHaveBeenCalledTimes(1)
        expect(verify).toHaveBeenCalledTimes(1)
        expect(submit).toHaveBeenCalledTimes(1)
        expect(current!.state.action).toBeNull()
        expect(current!.state.isNavigating).toBe(false)
        await act(async () => {
            current!.handler.handleRequest(providerId, 'link')
        })
        await act(async () => {
            current!.handler.handlePassword()
        })
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
        expect(verify).toHaveBeenCalledTimes(2)
    })
})

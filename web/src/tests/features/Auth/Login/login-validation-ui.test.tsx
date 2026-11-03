import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import {
    focusManager,
    onlineManager,
    QueryClient,
    QueryClientProvider,
} from '@tanstack/react-query'
import { InputProvider } from '@rentnerkev/inputs'
import { TooltipProvider } from '@rentnerkev/tooltips/tooltip'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
// Happy DOM does not implement the browser's native navigation cancellation API.
Object.defineProperty(window, 'stop', { configurable: true, writable: true, value: () => {} })

let search: {
    oidcError?: 'failed' | 'denied' | 'unavailable' | 'expired' | 'conflict'
} = {}
const navigate = mock(async (_options: unknown) => {})
const errorToast = mock((_message: string, _options?: unknown) => {})
const successToast = mock((_message: string, _options?: unknown) => {})
const infoToast = mock((_message: string, _options?: unknown) => {})
const passkeyLogin = mock(async () => ({ success: false, message: 'Unavailable.' }))
const login = mock(async (_input: unknown) => ({ success: false, message: 'Invalid credentials.' }))
let providerListAvailable = false
let providerListFailsClosed = false
let providerCatalogDelay: Promise<void> | undefined
let providerCatalogRequests = 0
mock.module('@/features/Auth/Login/middleware.ts', () => ({
    loginHandler: login,
    beginPasskeyLoginHandler: passkeyLogin,
    finishPasskeyLoginHandler: async () => ({ success: false, message: 'Unavailable.' }),
}))
mock.module('@/features/Auth/Oidc/middleware.ts', () => ({
    getPublicOidcProvidersHandler: async () => {
        providerCatalogRequests += 1
        await providerCatalogDelay
        if (providerListAvailable)
            return [{ id: '0194f777-4074-7000-8000-000000000003', name: 'Office' }]
        if (providerListFailsClosed) return []
        throw new Error('Provider list unavailable')
    },
}))
mock.module('@tanstack/react-router', () => ({
    useSearch: () => search,
    useNavigate: () => navigate,
    useRouter: () => ({ invalidate: async () => {} }),
    useRouterState: () => undefined,
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
const toastPackage = await import('@rentnerkev/toasts')
mock.module('@rentnerkev/toasts', () => ({
    ...toastPackage,
    toast: { ...toastPackage.toast, error: errorToast, info: infoToast, success: successToast },
}))

const { act, useEffect, StrictMode } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: useLoginLogic } = await import('@/features/Auth/Login/Hooks/useLoginLogic.ts')
const { default: LoginForm } = await import('@/features/Auth/Login/Components/LoginForm.tsx')
const { default: AlternativeLoginMethods } =
    await import('@/features/Auth/Login/Components/AlternativeLoginMethods.tsx')
type LoginState = ReturnType<typeof useLoginLogic>

let root: Root | null = null
let client: QueryClient | null = null
let state: LoginState | undefined

function LoginHarness() {
    return withTestLanguage(<LoginHarnessContent />)
}

function LoginHarnessContent() {
    const logic = useLoginLogic()
    useEffect(() => {
        state = logic
    }, [logic])
    return (
        <>
            <LoginForm state={logic.state} handler={logic.handler} form={logic.form} />
            <AlternativeLoginMethods
                state={logic.state}
                handler={logic.handler}
                refs={logic.refs}
            />
        </>
    )
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    client?.clear()
    client = null
    state = undefined
    login.mockReset()
    login.mockResolvedValue({ success: false, message: 'Invalid credentials.' })
    passkeyLogin.mockReset()
    passkeyLogin.mockResolvedValue({ success: false, message: 'Unavailable.' })
    errorToast.mockClear()
    successToast.mockClear()
    infoToast.mockClear()
    navigate.mockClear()
    search = {}
    providerListAvailable = false
    providerListFailsClosed = false
    providerCatalogDelay = undefined
    providerCatalogRequests = 0
    focusManager.setFocused(undefined)
    onlineManager.setOnline(true)
    document.body.replaceChildren()
})

test.each(['focus', 'reconnect'] as const)(
    'recovers an empty outage catalog on stale %s without blocking local login or clearing fields',
    async (event) => {
        providerListFailsClosed = true
        onlineManager.setOnline(true)
        focusManager.setFocused(true)
        const container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
        client = new QueryClient({
            defaultOptions: {
                queries: { refetchOnWindowFocus: false },
                mutations: { retry: false },
            },
        })
        await act(async () => {
            root!.render(
                <QueryClientProvider client={client!}>
                    <TooltipProvider>
                        <InputProvider locale="en">
                            <LoginHarness />
                        </InputProvider>
                    </TooltipProvider>
                </QueryClientProvider>,
            )
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        expect(providerCatalogRequests).toBe(1)
        expect(state!.state.alternativeSignInItems.map((item) => item.id)).toEqual(['passkey'])
        expect(container.querySelector('form[action="/api/auth/oidc/start"]')).not.toBeNull()
        await act(async () => {
            state!.form.setFieldValue('email', 'owner@example.test')
            state!.form.setFieldValue('password', 'valid password')
            client!.setQueryData(['auth', 'oidc-providers'], [], { updatedAt: Date.now() - 31_000 })
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        const localSubmit = container.querySelector<HTMLButtonElement>(
            'form button[type="submit"]',
        )!
        const passkeyButton = [
            ...container.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
        ].find((button) => button.textContent === 'Sign in with passkey')!
        let releaseCatalog: (() => void) | undefined
        providerCatalogDelay = new Promise<void>((resolve) => {
            releaseCatalog = resolve
        })
        providerListAvailable = true
        await act(async () => {
            if (event === 'focus') {
                focusManager.setFocused(false)
                focusManager.setFocused(true)
            } else {
                onlineManager.setOnline(false)
                onlineManager.setOnline(true)
            }
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        expect(providerCatalogRequests).toBeGreaterThan(1)
        expect(client!.isFetching({ queryKey: ['auth', 'oidc-providers'] })).toBe(1)
        expect([localSubmit.disabled, passkeyButton.disabled]).toEqual([false, false])
        await act(async () => {
            localSubmit.click()
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        expect(login).toHaveBeenCalledTimes(1)
        await act(async () => {
            releaseCatalog!()
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        expect(state!.state.alternativeSignInItems.map((item) => item.id)).toEqual([
            'passkey',
            '0194f777-4074-7000-8000-000000000003',
        ])
        expect(state!.form.state.values).toEqual({
            email: 'owner@example.test',
            password: 'valid password',
        })
        expect([localSubmit.disabled, passkeyButton.disabled]).toEqual([false, false])
        expect(providerCatalogRequests).toBeGreaterThan(1)
    },
)

test.each(['local', 'provider'] as const)(
    'explicit cancel stops the old navigation before admitting a new %s sign-in',
    async (nextMethod) => {
        providerListAvailable = true
        const container = await mountLogin()
        await act(async () => {
            state!.form.setFieldValue('email', 'owner@example.test')
            state!.form.setFieldValue('password', 'valid password')
        })
        const oidcForm = container.querySelector<HTMLFormElement>(
            'form[action="/api/auth/oidc/start"]',
        )!
        const localForm = container.querySelector<HTMLFormElement>('form:not([action])')!
        const localSubmit = localForm.querySelector<HTMLButtonElement>('button[type="submit"]')!
        const events: string[] = []
        const nativeSubmit = spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(
            () => {
                events.push('provider-navigation')
                oidcForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            },
        )
        const scheduled = spyOn(window, 'setTimeout')
        const stop = spyOn(window, 'stop').mockImplementation(() => {
            events.push('stop-old-navigation')
            expect(state!.state.isOidcPending).toBe(true)
            // The previous document navigation can still complete until stop returns.
            state!.handler.handleAlternativeSignIn('0194f777-4074-7000-8000-000000000003')
            localForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            expect(nativeSubmit).toHaveBeenCalledTimes(1)
            expect(login).not.toHaveBeenCalled()
            events.push('old-navigation-stopped')
        })
        try {
            await act(async () => directButton(container, 'Sign in with Office').click())
            expect(state!.state.isOidcPending).toBe(true)
            expect(localSubmit.disabled).toBe(true)
            expect(directButton(container, 'Sign in with passkey').disabled).toBe(true)
            // Advancing the former watchdog must never free a still-live native navigation.
            const oldWatchdogs = scheduled.mock.calls.filter(([, delay]) => delay === 15_000)
            await act(async () => {
                for (const [callback] of oldWatchdogs)
                    if (typeof callback === 'function') callback()
                state!.handler.handleAlternativeSignIn('0194f777-4074-7000-8000-000000000003')
                localForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            })
            expect(state!.state.isOidcPending).toBe(true)
            expect(nativeSubmit).toHaveBeenCalledTimes(1)
            expect(login).not.toHaveBeenCalled()
            expect(stop).not.toHaveBeenCalled()
            expect(oldWatchdogs).toHaveLength(0)
            await act(async () => directButton(container, 'Cancel sign-in').click())
            expect(stop).toHaveBeenCalledTimes(1)
            expect(events).toEqual([
                'provider-navigation',
                'stop-old-navigation',
                'old-navigation-stopped',
            ])
            expect(state!.state.isOidcPending).toBe(false)
            expect(localSubmit.disabled).toBe(false)
            expect(directButton(container, 'Sign in with passkey').disabled).toBe(false)
            expect(state!.form.state.values).toEqual({
                email: 'owner@example.test',
                password: 'valid password',
            })
            await act(async () => {
                if (nextMethod === 'provider')
                    directButton(container, 'Sign in with Office').click()
                else
                    localForm.dispatchEvent(
                        new Event('submit', { bubbles: true, cancelable: true }),
                    )
                await new Promise((resolve) => setTimeout(resolve, 5))
            })
            expect(nativeSubmit.mock.calls.length).toBe(nextMethod === 'provider' ? 2 : 1)
            expect(login.mock.calls.length).toBe(nextMethod === 'local' ? 1 : 0)
            if (nextMethod === 'provider') expect(events.at(-1)).toBe('provider-navigation')
        } finally {
            stop.mockRestore()
            scheduled.mockRestore()
            nativeSubmit.mockRestore()
        }
    },
)
test('a stale cancel handler cannot stop a newer provider navigation', async () => {
    providerListAvailable = true
    const container = await mountLogin()
    const form = container.querySelector<HTMLFormElement>('form[action="/api/auth/oidc/start"]')!
    const stop = spyOn(window, 'stop').mockImplementation(() => {})
    try {
        await act(async () =>
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        )
        const cancelAttemptA = state!.handler.handleCancelOidc
        await act(async () => cancelAttemptA())
        expect(stop).toHaveBeenCalledTimes(1)
        expect(state!.state.isOidcPending).toBe(false)
        await act(async () =>
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        )
        const cancelAttemptB = state!.handler.handleCancelOidc
        expect(state!.state.isOidcPending).toBe(true)
        await act(async () => cancelAttemptA())
        expect(stop).toHaveBeenCalledTimes(1)
        expect(state!.state.isOidcPending).toBe(true)
        expect(directButton(container, 'Sign in with Office').disabled).toBe(true)
        await act(async () => cancelAttemptB())
        expect(stop).toHaveBeenCalledTimes(2)
        expect(state!.state.isOidcPending).toBe(false)
    } finally {
        stop.mockRestore()
    }
})

test('reentrant cancellation during window.stop never stops the same navigation twice', async () => {
    providerListAvailable = true
    const container = await mountLogin()
    const form = container.querySelector<HTMLFormElement>('form[action="/api/auth/oidc/start"]')!
    await act(async () =>
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
    const cancelAttempt = state!.handler.handleCancelOidc
    let stops = 0
    const stop = spyOn(window, 'stop').mockImplementation(() => {
        stops += 1
        // Bound the regression probe even if a broken handler recurses.
        if (stops === 1) cancelAttempt()
        expect(state!.state.isOidcPending).toBe(true)
    })
    try {
        await act(async () => cancelAttempt())
        expect(stop).toHaveBeenCalledTimes(1)
        expect(state!.state.isOidcPending).toBe(false)
    } finally {
        stop.mockRestore()
    }
})

test('SPA unmount stops its active native navigation and invalidates retained cancel handlers', async () => {
    providerListAvailable = true
    const container = await mountLogin()
    const form = container.querySelector<HTMLFormElement>('form[action="/api/auth/oidc/start"]')!
    const stop = spyOn(window, 'stop').mockImplementation(() => {})
    try {
        await act(async () =>
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        )
        const cancelAttempt = state!.handler.handleCancelOidc
        expect(state!.state.isOidcPending).toBe(true)
        await act(async () => root!.unmount())
        root = null
        expect(stop).toHaveBeenCalledTimes(1)
        cancelAttempt()
        expect(stop).toHaveBeenCalledTimes(1)
    } finally {
        stop.mockRestore()
    }
})

test('failed native cancellation keeps the old navigation exclusive until cancellation succeeds', async () => {
    providerListAvailable = true
    const container = await mountLogin()
    const form = container.querySelector<HTMLFormElement>('form[action="/api/auth/oidc/start"]')!
    await act(async () =>
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
    const failure = new Error('Browser could not stop navigation')
    const stop = spyOn(window, 'stop').mockImplementation(() => {
        throw failure
    })
    try {
        expect(() => state!.handler.handleCancelOidc()).toThrow(failure)
        expect(state!.state.isOidcPending).toBe(true)
        const duplicate = new Event('submit', { bubbles: true, cancelable: true })
        await act(async () => form.dispatchEvent(duplicate))
        expect(duplicate.defaultPrevented).toBe(true)
        expect(directButton(container, 'Sign in with passkey').disabled).toBe(true)
        stop.mockImplementation(() => {})
        await act(async () => directButton(container, 'Cancel sign-in').click())
        expect(stop).toHaveBeenCalledTimes(2)
        expect(state!.state.isOidcPending).toBe(false)
        expect(directButton(container, 'Sign in with passkey').disabled).toBe(false)
    } finally {
        stop.mockRestore()
    }
})

test('restoring login from BFCache unlocks OIDC pending controls and cleans up its listener', async () => {
    providerListAvailable = true
    const added = spyOn(window, 'addEventListener')
    const removed = spyOn(window, 'removeEventListener')
    try {
        const container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
        client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
        await act(async () => {
            root!.render(
                <QueryClientProvider client={client!}>
                    <TooltipProvider>
                        <InputProvider locale="en">
                            <LoginHarness />
                        </InputProvider>
                    </TooltipProvider>
                </QueryClientProvider>,
            )
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        await act(async () => {
            state!.form.setFieldValue('email', 'owner@example.test')
            state!.form.setFieldValue('password', 'valid password')
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        const localSubmit = container.querySelector<HTMLButtonElement>(
            'form button[type="submit"]',
        )!
        const passkeyButton = [
            ...container.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
        ].find((button) => button.textContent === 'Sign in with passkey')!
        const oidcForm = container.querySelector<HTMLFormElement>(
            'form[action="/api/auth/oidc/start"]',
        )!
        expect([localSubmit.disabled, passkeyButton.disabled]).toEqual([false, false])
        const submit = new Event('submit', { bubbles: true, cancelable: true })
        await act(async () => {
            oidcForm.dispatchEvent(submit)
        })
        expect(submit.defaultPrevented).toBeFalse()
        expect([localSubmit.disabled, passkeyButton.disabled]).toEqual([true, true])
        const ordinaryPageShow = new Event('pageshow')
        Object.defineProperty(ordinaryPageShow, 'persisted', { value: false })
        await act(async () => {
            window.dispatchEvent(ordinaryPageShow)
        })
        expect([localSubmit.disabled, passkeyButton.disabled]).toEqual([true, true])
        const restoredPageShow = new Event('pageshow')
        Object.defineProperty(restoredPageShow, 'persisted', { value: true })
        await act(async () => {
            window.dispatchEvent(restoredPageShow)
        })
        expect([localSubmit.disabled, passkeyButton.disabled]).toEqual([false, false])
        await act(async () => {
            localSubmit.click()
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        expect(login).toHaveBeenCalledTimes(1)
        const listener = added.mock.calls.find(([event]) => event === 'pageshow')?.[1]
        expect(listener).toBeDefined()
        await act(async () => root?.unmount())
        root = null
        expect(
            removed.mock.calls.some(
                ([event, callback]) => event === 'pageshow' && callback === listener,
            ),
        ).toBeTrue()
    } finally {
        added.mockRestore()
        removed.mockRestore()
    }
})

test('login validation toasts errors, retains invalid marking and clears after corrected submission', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client!}>
                <TooltipProvider>
                    <InputProvider locale="en">
                        <LoginHarness />
                    </InputProvider>
                </TooltipProvider>
            </QueryClientProvider>,
        )
    })
    const inputs = [
        ...container.querySelectorAll<HTMLInputElement>('form:not([action]) input[name]'),
    ]
    expect(inputs).toHaveLength(2)
    expect(inputs.every((input) => input.getAttribute('aria-invalid') !== 'true')).toBeTrue()
    expect(container.querySelector('[role="alert"]')).toBeNull()

    await act(async () => {
        const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!
        submit.focus()
        submit.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(login).not.toHaveBeenCalled()
    for (const input of inputs) {
        expect(input.getAttribute('aria-invalid')).toBe('true')
        expect(container.querySelector(`label[for="${input.id}"]`)).not.toBeNull()
        expect(
            document.getElementById(`${input.id}-error`)?.classList.contains('sr-only'),
        ).toBeTrue()
        expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-error`)
    }

    expect(errorToast.mock.calls.length).toBeGreaterThan(0)
    expect(container.querySelector('[id$="-error"]:not(.sr-only)')).toBeNull()
    await act(async () => {
        state!.form.setFieldValue('email', 'owner@example.test')
        state!.form.setFieldValue('password', 'valid password')
        await state!.form.handleSubmit()
        await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(login).toHaveBeenCalledTimes(1)
    expect(inputs.every((input) => input.getAttribute('aria-invalid') !== 'true')).toBeTrue()
    expect(container.querySelector('[role="alert"]')).toBeNull()
})

async function mountLogin(strict = false) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    client = new QueryClient({
        defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
    })
    const content = (
        <QueryClientProvider client={client}>
            <TooltipProvider>
                <InputProvider locale="en">
                    <LoginHarness />
                </InputProvider>
            </TooltipProvider>
        </QueryClientProvider>
    )
    await act(async () => {
        root!.render(strict ? <StrictMode>{content}</StrictMode> : content)
        await new Promise((resolve) => setTimeout(resolve, 10))
    })
    await waitForLogin(() => Boolean(state && !state.state.isProviderCatalogPending))
    return container
}

async function waitForLogin(condition: () => boolean) {
    const deadline = Date.now() + 2_000
    while (!condition()) {
        if (Date.now() >= deadline) throw new Error('Login UI did not settle')
        // oxlint-disable-next-line no-await-in-loop -- Bounded React query-notification flush.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
    }
}

function directButton(container: ParentNode, label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent === label,
    )
    if (!button) throw new Error(`Missing direct login action: ${label}`)
    return button
}

test('invalid local validation releases its admission so passkey recovery remains usable', async () => {
    providerListAvailable = true
    const container = await mountLogin()
    const localForm = container.querySelector<HTMLFormElement>('form:not([action])')!
    await act(async () => {
        localForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        directButton(container, 'Sign in with passkey').click()
        await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(login).not.toHaveBeenCalled()
    expect(passkeyLogin).not.toHaveBeenCalled()
    await act(async () => {
        directButton(container, 'Sign in with passkey').click()
        await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(passkeyLogin).toHaveBeenCalledTimes(1)
    expect(state!.form.state.values).toEqual({ email: '', password: '' })
})

test('automatic catalog invalidation recovers providers without clearing or blocking local credentials', async () => {
    const container = await mountLogin()
    expect(state!.state.isProviderCatalogUnavailable).toBe(true)
    await act(async () => {
        state!.form.setFieldValue('email', 'owner@example.test')
        state!.form.setFieldValue('password', 'private local password')
    })
    let release!: () => void
    providerCatalogDelay = new Promise<void>((resolve) => {
        release = resolve
    })
    providerListAvailable = true
    await act(async () => {
        void client!.invalidateQueries({ queryKey: ['auth', 'oidc-providers'] })
        await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(providerCatalogRequests).toBeGreaterThan(1)
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
        false,
    )
    expect(directButton(container, 'Sign in with passkey').disabled).toBe(false)
    expect(state!.form.state.values).toEqual({
        email: 'owner@example.test',
        password: 'private local password',
    })
    await act(async () => {
        release()
        await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(state!.state.isProviderCatalogUnavailable).toBe(false)
    expect(directButton(container, 'Sign in with Office').disabled).toBe(false)
    expect(state!.form.state.values).toEqual({
        email: 'owner@example.test',
        password: 'private local password',
    })
    expect(login).not.toHaveBeenCalled()
})

test.each([
    { marker: 'unknown' },
    { marker: '<img src=x onerror=alert(1)>' },
    { marker: 'https://provider.example/?code=private-token' },
    { marker: ['failed', 'denied'] },
])(
    'ignores unrecognized external failure marker %j without rendering raw query data',
    async ({ marker }) => {
        Object.assign(search, { oidcError: marker })
        const container = await mountLogin(true)
        expect(errorToast).not.toHaveBeenCalled()
        expect(navigate).not.toHaveBeenCalled()
        expect(container.querySelector('[role="alert"]')).toBeNull()
        expect(container.querySelector('img')).toBeNull()
        expect(container.textContent).not.toContain('private-token')
        expect(container.textContent).not.toContain('onerror')
        expect(container.querySelector('input[name="email"]')).not.toBeNull()
    },
)

test.each(['provider', 'passkey', 'local'] as const)(
    'synchronous double clicks admit only one %s authentication operation',
    async (method) => {
        providerListAvailable = true
        let release!: () => void
        const pending = new Promise<{ success: boolean; message: string }>((resolve) => {
            release = () => resolve({ success: false, message: 'Unavailable.' })
        })
        login.mockImplementation(async () => pending)
        passkeyLogin.mockImplementation(async () => pending)
        const container = await mountLogin()
        await act(async () => {
            state!.form.setFieldValue('email', 'owner@example.test')
            state!.form.setFieldValue('password', 'private local password')
        })
        const oidcForm = container.querySelector<HTMLFormElement>(
            'form[action="/api/auth/oidc/start"]',
        )!
        let providerSubmissions = 0
        const nativeSubmit = spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(
            () => {
                if (method === 'provider') providerSubmissions += 1
                const submittedForm =
                    method === 'provider'
                        ? oidcForm
                        : container.querySelector<HTMLFormElement>('form:not([action])')!
                submittedForm.dispatchEvent(
                    new Event('submit', { bubbles: true, cancelable: true }),
                )
            },
        )
        try {
            const button =
                method === 'local'
                    ? container.querySelector<HTMLButtonElement>('button[type="submit"]')!
                    : directButton(
                          container,
                          method === 'provider' ? 'Sign in with Office' : 'Sign in with passkey',
                      )
            await act(async () => {
                button.click()
                button.click()
                await new Promise((resolve) => setTimeout(resolve, 5))
            })
            expect(providerSubmissions).toBe(method === 'provider' ? 1 : 0)
            expect(passkeyLogin.mock.calls.length).toBe(method === 'passkey' ? 1 : 0)
            expect(login.mock.calls.length).toBe(method === 'local' ? 1 : 0)
            expect(
                directButton(
                    container,
                    method === 'passkey' ? 'Checking passkey…' : 'Sign in with passkey',
                ).disabled,
            ).toBe(true)
            expect(directButton(container, 'Sign in with Office').disabled).toBe(true)
        } finally {
            await act(async () => {
                release()
                await pending
                await new Promise((resolve) => setTimeout(resolve, 5))
            })
            nativeSubmit.mockRestore()
        }
    },
)

test.each(['provider', 'passkey', 'local'] as const)(
    'the first synchronous %s action excludes other sign-in methods before React rerenders',
    async (method) => {
        providerListAvailable = true
        let release!: () => void
        const pending = new Promise<{ success: boolean; message: string }>((resolve) => {
            release = () => resolve({ success: false, message: 'Unavailable.' })
        })
        login.mockImplementation(async () => pending)
        passkeyLogin.mockImplementation(async () => pending)
        const container = await mountLogin()
        await act(async () => {
            state!.form.setFieldValue('email', 'owner@example.test')
            state!.form.setFieldValue('password', 'private local password')
        })
        const form = container.querySelector<HTMLFormElement>(
            'form[action="/api/auth/oidc/start"]',
        )!
        const nativeSubmit = spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(
            () => {
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            },
        )
        try {
            const localForm = container.querySelector<HTMLFormElement>('form:not([action])')!
            const start = {
                local: () =>
                    localForm.dispatchEvent(
                        new Event('submit', { bubbles: true, cancelable: true }),
                    ),
                passkey: () => directButton(container, 'Sign in with passkey').click(),
                provider: () => directButton(container, 'Sign in with Office').click(),
            }
            await act(async () => {
                start[method]()
                for (const alternate of ['local', 'passkey', 'provider'] as const)
                    if (alternate !== method) start[alternate]()
                await new Promise((resolve) => setTimeout(resolve, 5))
            })
            expect(nativeSubmit.mock.calls.length).toBe(method === 'provider' ? 1 : 0)
            expect(login.mock.calls.length).toBe(method === 'local' ? 1 : 0)
            expect(passkeyLogin.mock.calls.length).toBe(method === 'passkey' ? 1 : 0)
        } finally {
            await act(async () => {
                release()
                await pending
                await new Promise((resolve) => setTimeout(resolve, 5))
            })
            nativeSubmit.mockRestore()
        }
    },
)

test.each([
    ['failed', 'Sign-in failed. Try again or use your local account.'],
    [
        'denied',
        'This identity is not allowed to sign in. Contact your administrator or use your local account.',
    ],
    [
        'unavailable',
        'The identity provider could not be reached. Try again or use your local password or passkey.',
    ],
    ['expired', 'This sign-in request has expired. Start sign-in again.'],
    ['conflict', 'The sign-in configuration changed. Start sign-in again.'],
] as const)(
    'validated callback marker %s is consumed once in StrictMode and remains visible as a safe inline alert',
    async (code, message) => {
        search = { oidcError: code }
        const container = await mountLogin(true)
        expect(errorToast).toHaveBeenCalledTimes(1)
        expect(errorToast.mock.calls[0]?.[0]).toBe(message)
        expect(navigate).toHaveBeenCalledTimes(1)
        expect(navigate).toHaveBeenCalledWith({ to: '/login', search: {}, replace: true })
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(message)
        expect(container.querySelector('input[name="email"]')).not.toBeNull()
    },
)

test('alternative provider selection forwards only its UUID through native submission and passkey stays local', async () => {
    providerListAvailable = true
    const container = await mountLogin()
    await act(async () => {
        state!.form.setFieldValue('email', 'owner@example.test')
        state!.form.setFieldValue('password', 'private local password')
    })
    const oidcForm = container.querySelector<HTMLFormElement>(
        'form[action="/api/auth/oidc/start"]',
    )!
    let submission: Event | undefined
    let submittedFields: Array<[string, string]> = []
    const nativeSubmit = spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(
        () => {
            submittedFields = [...oidcForm.querySelectorAll<HTMLInputElement>('input[name]')].map(
                (input) => [input.name, input.value],
            )
            submission = new Event('submit', { bubbles: true, cancelable: true })
            oidcForm.dispatchEvent(submission)
        },
    )
    async function selectDirectButton(label: string) {
        const item = [
            ...container.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
        ].find((entry) => entry.textContent === label)!
        expect(item).toBeDefined()
        await act(async () => {
            item.click()
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
    }
    try {
        await selectDirectButton('Sign in with passkey')
        expect(passkeyLogin).toHaveBeenCalledTimes(1)
        expect(nativeSubmit).not.toHaveBeenCalled()
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25))
        })
        expect(state!.state.isPasskeyPending).toBeFalse()
        await selectDirectButton('Sign in with Office')
        expect(nativeSubmit).toHaveBeenCalledTimes(1)
        expect(submission?.defaultPrevented).toBeFalse()
        expect(submittedFields).toEqual([['providerId', '0194f777-4074-7000-8000-000000000003']])
        expect(login).not.toHaveBeenCalled()
        expect(state!.state.isPending).toBeTrue()
        expect(state!.form.state.values.password).toBe('private local password')
    } finally {
        nativeSubmit.mockRestore()
    }
})

test.each(['local', 'passkey'] as const)(
    '%s login reports the successful server result after navigation',
    async (method) => {
        login.mockResolvedValue({ success: true, message: 'Welcome back.' })
        passkeyLogin.mockResolvedValue({ success: true, message: 'Welcome back.' })
        await mountLogin()
        await act(async () => {
            if (method === 'passkey') {
                await state!.handler.handlePasskeyLogin()
            } else {
                state!.form.setFieldValue('email', 'owner@example.test')
                state!.form.setFieldValue('password', 'valid password')
                await state!.form.handleSubmit()
            }
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
        expect(successToast.mock.calls.map(([message]) => message)).toEqual(['Welcome back.'])
        expect(navigate.mock.invocationCallOrder[0]!).toBeLessThan(
            successToast.mock.invocationCallOrder[0]!,
        )
        expect(errorToast).not.toHaveBeenCalled()
    },
)

test('local login requiring a second factor reports informational feedback after navigation', async () => {
    login.mockImplementation(async () => ({
        success: false,
        requiresTwoFactor: true,
        message: 'Verify your second factor.',
    }))
    await mountLogin()
    await act(async () => {
        state!.form.setFieldValue('email', 'owner@example.test')
        state!.form.setFieldValue('password', 'valid password')
        await state!.form.handleSubmit()
        await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(navigate).toHaveBeenCalledWith({ to: '/login/two-factor', replace: true })
    expect(infoToast.mock.calls.map(([message]) => message)).toEqual(['Verify your second factor.'])
    expect(errorToast).not.toHaveBeenCalled()
})

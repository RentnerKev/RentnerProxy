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

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let search: { oidcError?: 'failed' } = {}
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
        const menuTrigger = [
            ...container.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
        ].find((button) => button.textContent === 'More sign-in options')!
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
        expect(providerCatalogRequests).toBe(2)
        expect(client!.isFetching({ queryKey: ['auth', 'oidc-providers'] })).toBe(1)
        expect([localSubmit.disabled, menuTrigger.disabled]).toEqual([false, false])
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
        expect([localSubmit.disabled, menuTrigger.disabled]).toEqual([false, false])
        expect(providerCatalogRequests).toBe(2)
    },
)

test('canceled provider navigation recovers controls after its bounded window and cleans up timers', async () => {
    providerListAvailable = true
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
    const localSubmit = container.querySelector<HTMLButtonElement>('form button[type="submit"]')!
    const menuTrigger = [
        ...container.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
    ].find((button) => button.textContent === 'More sign-in options')!
    const oidcForm = container.querySelector<HTMLFormElement>(
        'form[action="/api/auth/oidc/start"]',
    )!
    const scheduled = spyOn(window, 'setTimeout')
    const cleared = spyOn(window, 'clearTimeout')
    try {
        await act(async () => {
            oidcForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        })
        expect([localSubmit.disabled, menuTrigger.disabled]).toEqual([true, true])
        const duplicate = new Event('submit', { bubbles: true, cancelable: true })
        await act(async () => {
            oidcForm.dispatchEvent(duplicate)
        })
        expect(duplicate.defaultPrevented).toBeTrue()
        const index = scheduled.mock.calls.findIndex(([, delay]) => delay === 15_000)
        const recover = scheduled.mock.calls[index]?.[0]
        if (typeof recover !== 'function')
            throw new Error('Missing bounded navigation recovery callback')
        const recoveryTimer = scheduled.mock.results[index]?.value
        // Simulate expiry while the original page remains mounted; no pageshow/unload is dispatched.
        await act(async () => {
            recover()
        })
        expect([localSubmit.disabled, menuTrigger.disabled]).toEqual([false, false])
        expect(cleared).toHaveBeenCalledWith(recoveryTimer)
        expect(state!.form.state.values).toEqual({
            email: 'owner@example.test',
            password: 'valid password',
        })
        await act(async () => {
            localSubmit.click()
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        expect(login).toHaveBeenCalledTimes(1)
        await act(async () => {
            oidcForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        })
        const lastIndex = scheduled.mock.calls.findLastIndex(([, delay]) => delay === 15_000)
        expect(lastIndex).toBeGreaterThan(index)
        const pendingTimer = scheduled.mock.results[lastIndex]?.value
        await act(async () => root?.unmount())
        root = null
        expect(cleared).toHaveBeenCalledWith(pendingTimer)
    } finally {
        scheduled.mockRestore()
        cleared.mockRestore()
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
        const menuTrigger = [
            ...container.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
        ].find((button) => button.textContent === 'More sign-in options')!
        const oidcForm = container.querySelector<HTMLFormElement>(
            'form[action="/api/auth/oidc/start"]',
        )!
        expect([localSubmit.disabled, menuTrigger.disabled]).toEqual([false, false])
        const submit = new Event('submit', { bubbles: true, cancelable: true })
        await act(async () => {
            oidcForm.dispatchEvent(submit)
        })
        expect(submit.defaultPrevented).toBeFalse()
        expect([localSubmit.disabled, menuTrigger.disabled]).toEqual([true, true])
        const ordinaryPageShow = new Event('pageshow')
        Object.defineProperty(ordinaryPageShow, 'persisted', { value: false })
        await act(async () => {
            window.dispatchEvent(ordinaryPageShow)
        })
        expect([localSubmit.disabled, menuTrigger.disabled]).toEqual([true, true])
        const restoredPageShow = new Event('pageshow')
        Object.defineProperty(restoredPageShow, 'persisted', { value: true })
        await act(async () => {
            window.dispatchEvent(restoredPageShow)
        })
        expect([localSubmit.disabled, menuTrigger.disabled]).toEqual([false, false])
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
        expect(document.getElementById(`${input.id}-error`)).toBeNull()
    }

    expect(errorToast.mock.calls.length).toBeGreaterThan(0)
    expect(container.querySelector('[id$="-error"]')).toBeNull()
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
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
    return container
}

test('a validated OIDC callback failure toasts once in StrictMode and removes the callback search', async () => {
    search = { oidcError: 'failed' }
    const container = await mountLogin(true)
    expect(errorToast).toHaveBeenCalledTimes(1)
    expect(errorToast.mock.calls[0]?.[0]).toBe(
        'Sign-in failed. Try again or use your local account.',
    )
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({ to: '/login', search: {}, replace: true })
    expect(container.querySelector('[role="alert"], output')).toBeNull()
    expect(container.querySelector('input[name="email"]')).not.toBeNull()
})

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
    async function selectMenuItem(label: string) {
        await act(async () =>
            container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click(),
        )
        const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
            (entry) =>
                document.getElementById(entry.getAttribute('aria-labelledby') ?? '')
                    ?.textContent === label,
        )!
        expect(item).toBeDefined()
        await act(async () => {
            item.click()
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
    }
    try {
        await selectMenuItem('Sign in with passkey')
        expect(passkeyLogin).toHaveBeenCalledTimes(1)
        expect(nativeSubmit).not.toHaveBeenCalled()
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25))
        })
        expect(state!.state.isPasskeyPending).toBeFalse()
        await selectMenuItem('Sign in with Office')
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

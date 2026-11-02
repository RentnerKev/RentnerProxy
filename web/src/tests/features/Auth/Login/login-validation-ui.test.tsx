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

const login = mock(async (_input: unknown) => ({ success: false, message: 'Invalid credentials.' }))
let providerListAvailable = false
let providerListFailsClosed = false
let providerCatalogDelay: Promise<void> | undefined
let providerCatalogRequests = 0
mock.module('@/features/Auth/Login/middleware.ts', () => ({
    loginHandler: login,
    beginPasskeyLoginHandler: async () => ({ success: false, message: 'Unavailable.' }),
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
    useSearch: () => ({}),
    useNavigate: () => async () => {},
    useRouter: () => ({ invalidate: async () => {} }),
    useRouterState: () => undefined,
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
const toastPackage = await import('@rentnerkev/toasts')
mock.module('@rentnerkev/toasts', () => ({
    ...toastPackage,
    toast: { ...toastPackage.toast, error: () => {}, info: () => {} },
}))

const { act, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: useLoginLogic } = await import('@/features/Auth/Login/Hooks/useLoginLogic.ts')
const { default: LoginForm } = await import('@/features/Auth/Login/Components/LoginForm.tsx')
const { default: OidcLoginProviders } =
    await import('@/features/Auth/Login/Components/OidcLoginProviders.tsx')
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
            <LoginForm
                state={logic.state}
                handler={logic.handler}
                form={logic.form}
                onPasskeyLogin={() => void logic.handler.handlePasskeyLogin()}
            />
            <OidcLoginProviders state={logic.state} onSubmit={logic.handler.handleOidcSubmit} />
        </>
    )
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    client?.clear()
    client = null
    state = undefined
    login.mockClear()
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
        expect(state!.state.oidcProviders).toEqual([])
        expect(container.querySelector('form[action="/api/auth/oidc/start"]')).toBeNull()
        await act(async () => {
            state!.form.setFieldValue('email', 'owner@example.test')
            state!.form.setFieldValue('password', 'valid password')
            client!.setQueryData(['auth', 'oidc-providers'], [], { updatedAt: Date.now() - 31_000 })
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        const localSubmit = container.querySelector<HTMLButtonElement>(
            'form button[type="submit"]',
        )!
        const passkey = [
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
        expect(providerCatalogRequests).toBe(2)
        expect(client!.isFetching({ queryKey: ['auth', 'oidc-providers'] })).toBe(1)
        expect([localSubmit.disabled, passkey.disabled]).toEqual([false, false])
        await act(async () => {
            localSubmit.click()
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        expect(login).toHaveBeenCalledTimes(1)
        await act(async () => {
            releaseCatalog!()
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        expect(
            container.querySelector('form[action="/api/auth/oidc/start"] button')?.textContent,
        ).toBe('Sign in with Office')
        expect(state!.form.state.values).toEqual({
            email: 'owner@example.test',
            password: 'valid password',
        })
        expect([localSubmit.disabled, passkey.disabled]).toEqual([false, false])
        expect(providerCatalogRequests).toBe(2)
    },
)

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
        const passkey = [
            ...container.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
        ].find((button) => button.textContent === 'Sign in with passkey')!
        const oidcForm = container.querySelector<HTMLFormElement>(
            'form[action="/api/auth/oidc/start"]',
        )!
        const oidcSubmit = oidcForm.querySelector<HTMLButtonElement>('button')!
        expect([localSubmit.disabled, passkey.disabled, oidcSubmit.disabled]).toEqual([
            false,
            false,
            false,
        ])
        const submit = new Event('submit', { bubbles: true, cancelable: true })
        await act(async () => {
            oidcForm.dispatchEvent(submit)
        })
        expect(submit.defaultPrevented).toBeFalse()
        expect([localSubmit.disabled, passkey.disabled, oidcSubmit.disabled]).toEqual([
            true,
            true,
            true,
        ])
        const ordinaryPageShow = new Event('pageshow')
        Object.defineProperty(ordinaryPageShow, 'persisted', { value: false })
        await act(async () => {
            window.dispatchEvent(ordinaryPageShow)
        })
        expect([localSubmit.disabled, passkey.disabled, oidcSubmit.disabled]).toEqual([
            true,
            true,
            true,
        ])
        const restoredPageShow = new Event('pageshow')
        Object.defineProperty(restoredPageShow, 'persisted', { value: true })
        await act(async () => {
            window.dispatchEvent(restoredPageShow)
        })
        expect([localSubmit.disabled, passkey.disabled, oidcSubmit.disabled]).toEqual([
            false,
            false,
            false,
        ])
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

test('login errors announce invalid fields, retain descriptions and clear after corrected submission', async () => {
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
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[name]')]
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
        const error = document.getElementById(input.getAttribute('aria-describedby')!)!
        expect(error.getAttribute('role')).toBe('alert')
        expect(error.textContent?.trim().length).toBeGreaterThan(0)
    }

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

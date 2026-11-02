import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InputProvider } from '@rentnerkev/inputs'
import { TooltipProvider } from '@rentnerkev/tooltips/tooltip'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const status = mock(async () => ({ valid: false, methods: [] as string[] }))
const navigate = mock(async (_options: unknown) => {})
const invalidate = mock(async () => {})
const errorToast = mock((_message: string, _options?: unknown) => {})
const warningToast = mock((_message: string, _options?: unknown) => {})

mock.module('@/features/Auth/Login/middleware.ts', () => ({
    getTwoFactorChallengeStatusHandler: status,
    completeTwoFactorLoginHandler: async () => ({ success: false, message: 'Invalid code.' }),
}))
mock.module('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    useRouter: () => ({ invalidate }),
    useRouterState: () => undefined,
    Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}))
const toastPackage = await import('@rentnerkev/toasts')
mock.module('@rentnerkev/toasts', () => ({
    ...toastPackage,
    toast: { ...toastPackage.toast, error: errorToast, warning: warningToast },
}))

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: TwoFactorLoginPage } =
    await import('@/features/Auth/Login/Components/TwoFactorLoginPage.tsx')

let root: Root | null = null
let client: QueryClient | null = null

async function mount(children: ReactNode) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client!}>
                <TooltipProvider>
                    <InputProvider locale="en">{children}</InputProvider>
                </TooltipProvider>
            </QueryClientProvider>,
        )
    })
}

async function until(predicate: () => boolean) {
    const deadline = Date.now() + 1500
    while (!predicate() && Date.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop -- Flush asynchronous React Query notifications.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
    }
    expect(predicate()).toBeTrue()
}

beforeEach(() => {
    status.mockReset()
    status.mockResolvedValue({ valid: false, methods: [] })
    navigate.mockClear()
    invalidate.mockClear()
    errorToast.mockClear()
    warningToast.mockClear()
})

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    client?.clear()
    client = null
    document.body.replaceChildren()
})

test('an expired second-factor request has an actionable sign-in link', async () => {
    await mount(<TwoFactorLoginPage />)
    await until(() => warningToast.mock.calls.length === 1)
    expect(warningToast.mock.calls[0]?.[0]).toContain('expired')
    expect(document.querySelector('[role="alert"], output')).toBeNull()
    expect(document.querySelector('a[href="/login"]')?.textContent).toBe('Back to sign in')
    expect(document.querySelector('button')?.textContent).toBe('Show sign-in status')
})

test('a failed second-factor status check reports availability and offers a working retry', async () => {
    status.mockRejectedValueOnce(new Error('private transport diagnostic'))
    await mount(<TwoFactorLoginPage />)
    await until(() => Boolean(document.querySelector('button')))
    expect(errorToast.mock.calls[0]?.[0]).toContain('temporarily unavailable')
    expect(document.querySelector('[role="alert"], output')).toBeNull()
    expect(document.body.textContent).not.toContain('expired')
    expect(document.body.textContent).not.toContain('private transport diagnostic')
    expect(document.querySelector('a[href="/login"]')).not.toBeNull()
    await act(async () => document.querySelector('button')!.click())
    await until(() => warningToast.mock.calls.length === 1)
    expect(warningToast.mock.calls[0]?.[0]).toContain('expired')
    expect(JSON.stringify([...errorToast.mock.calls, ...warningToast.mock.calls])).not.toContain(
        'private transport diagnostic',
    )
    expect(status).toHaveBeenCalledTimes(2)
})

test('a failed recheck does not keep displaying a previously valid second-factor form', async () => {
    status.mockResolvedValueOnce({ valid: true, methods: ['totp'] })
    await mount(<TwoFactorLoginPage />)
    await until(() => Boolean(document.querySelector('input[name="credential"]')))
    status.mockRejectedValueOnce(new Error('private transport diagnostic'))
    await act(async () => {
        await client!.invalidateQueries({ queryKey: ['auth', 'two-factor-challenge'] })
    })
    await until(() => errorToast.mock.calls.length === 1)
    expect(document.querySelector('input[name="credential"]')).toBeNull()
    expect(errorToast.mock.calls[0]?.[0]).toContain('temporarily unavailable')
    expect(document.querySelector('[role="alert"], output')).toBeNull()
    expect(document.body.textContent).not.toContain('expired')
    expect(document.querySelector('button')?.textContent).toBe('Try again')
})

test('a retried unavailable challenge notifies again without exposing transport diagnostics', async () => {
    status.mockRejectedValue(new Error('private transport diagnostic'))
    await mount(<TwoFactorLoginPage />)
    await until(() => errorToast.mock.calls.length === 1)
    await act(async () => document.querySelector('button')!.click())
    await until(() => errorToast.mock.calls.length === 2)
    expect(status).toHaveBeenCalledTimes(2)
    expect(
        errorToast.mock.calls.every(([message]) => message.includes('temporarily unavailable')),
    ).toBeTrue()
    expect(JSON.stringify(errorToast.mock.calls)).not.toContain('private transport diagnostic')
    expect(document.querySelector('[role="alert"], output')).toBeNull()
})

test('an invalid second-factor credential uses toast feedback and retains invalid marking', async () => {
    status.mockResolvedValueOnce({ valid: true, methods: ['totp'] })
    await mount(<TwoFactorLoginPage />)
    await until(() => Boolean(document.querySelector('input[name="credential"]')))
    await act(async () => {
        document
            .querySelector<HTMLFormElement>('form')!
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(errorToast.mock.calls.length).toBeGreaterThan(0)
    expect(document.querySelector('input[name="credential"]')?.getAttribute('aria-invalid')).toBe(
        'true',
    )
    expect(
        document.querySelector('[id$="-error"]:not(.sr-only), [role="alert"], output'),
    ).toBeNull()
    const input = document.querySelector<HTMLInputElement>('input[name="credential"]')!
    await act(async () => input.focus())
    expect(document.activeElement === input).toBeTrue()
    const description = document.getElementById(input.getAttribute('aria-describedby')!)!
    expect(description.classList.contains('sr-only')).toBeTrue()
    expect(description.textContent?.length).toBeGreaterThan(0)
    expect(description.hasAttribute('role')).toBeFalse()
})

test.each(['expired', 'unavailable'] as const)(
    'the keyboard-focusable status action replays %s feedback without a new request',
    async (kind) => {
        if (kind === 'unavailable')
            status.mockRejectedValueOnce(new Error('private transport diagnostic'))
        await mount(<TwoFactorLoginPage />)
        const feedback = kind === 'expired' ? warningToast : errorToast
        await until(() => feedback.mock.calls.length === 1)
        const replay = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
            (button) => button.textContent === 'Show sign-in status',
        )!
        feedback.mockClear()
        await act(async () => {
            replay.focus()
            replay.click()
        })
        expect(document.activeElement === replay).toBeTrue()
        expect(feedback.mock.calls.length).toBe(1)
        expect(feedback.mock.calls[0]?.[0]).toContain(
            kind === 'expired' ? 'expired' : 'temporarily unavailable',
        )
        expect(JSON.stringify(feedback.mock.calls)).not.toContain('private transport diagnostic')
        expect(status).toHaveBeenCalledTimes(1)
        expect(document.querySelector('[role="alert"], output')).toBeNull()
        expect(document.body.textContent).not.toContain(
            kind === 'expired' ? 'expired' : 'temporarily unavailable',
        )
        expect(document.querySelector('a[href="/login"]')).not.toBeNull()
    },
)

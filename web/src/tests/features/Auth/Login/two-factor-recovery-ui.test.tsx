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
mock.module('@rentnerkev/toasts/toast', () => ({
    toast: { error: errorToast, warning: warningToast },
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
    await until(() => Boolean(document.querySelector('[role="alert"]')))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('expired')
    expect(document.querySelector('a[href="/login"]')?.textContent).toBe('Back to sign in')
    expect(document.querySelector('button')).toBeNull()
})

test('a failed second-factor status check reports availability and offers a working retry', async () => {
    status.mockRejectedValueOnce(new Error('private transport diagnostic'))
    await mount(<TwoFactorLoginPage />)
    await until(() => Boolean(document.querySelector('button')))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        'temporarily unavailable',
    )
    expect(document.body.textContent).not.toContain('expired')
    expect(document.body.textContent).not.toContain('private transport diagnostic')
    expect(document.querySelector('a[href="/login"]')).not.toBeNull()
    await act(async () => document.querySelector('button')!.click())
    await until(() =>
        Boolean(document.querySelector('[role="alert"]')?.textContent?.includes('expired')),
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
    await until(() => Boolean(document.querySelector('[role="alert"]')))
    expect(document.querySelector('input[name="credential"]')).toBeNull()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        'temporarily unavailable',
    )
    expect(document.body.textContent).not.toContain('expired')
    expect(document.querySelector('button')?.textContent).toBe('Try again')
})

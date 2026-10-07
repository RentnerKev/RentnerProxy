import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const logout = mock(async () => ({ success: true, message: 'Signed out.' }))
const navigate = mock(async (_options: unknown) => {})
const invalidate = mock(async () => {})
const errorToast = mock((_message: string, _options?: unknown) => {})
const warningToast = mock((_message: string, _options?: unknown) => {})

mock.module('@/features/Auth/middleware.ts', () => ({ logoutHandler: logout }))
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
const { default: useLogout } = await import('@/features/Auth/Session/Hooks/useLogout.ts')

let root: Root | null = null
let client: QueryClient | null = null

function LogoutProbe() {
    const { state, handler } = useLogout()
    return (
        <button type="button" disabled={state.isLoggingOut} onClick={handler.handleLogout}>
            Sign out
        </button>
    )
}

async function mount(children: ReactNode) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    await act(async () => {
        root!.render(<QueryClientProvider client={client!}>{children}</QueryClientProvider>)
    })
}

async function until(predicate: () => boolean) {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
    })
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
    logout.mockReset()
    logout.mockResolvedValue({ success: true, message: 'Signed out.' })
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

test('a rejected sign-out keeps cached session state and offers a retry without navigation', async () => {
    logout.mockRejectedValueOnce(new Error('private transport diagnostic'))
    await mount(<LogoutProbe />)
    client!.setQueryData(['session-owned-data'], 'retained')
    await act(async () => document.querySelector('button')!.click())
    await until(() => errorToast.mock.calls.length === 1)
    expect(client!.getQueryData<string>(['session-owned-data'])).toBe('retained')
    expect(invalidate).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(warningToast).not.toHaveBeenCalled()
    expect(errorToast.mock.calls[0]?.[0]).toBe(
        'Could not sign out. Check your connection and try again.',
    )
    await until(() => !document.querySelector('button')!.disabled)
    await act(async () => document.querySelector('button')!.click())
    await until(() => navigate.mock.calls.length === 1)
    expect(logout).toHaveBeenCalledTimes(2)
    expect(client!.getQueryData(['session-owned-data'])).toBeUndefined()
    expect(navigate).toHaveBeenCalledWith({ to: '/login', replace: true })
})

test('a browser sign-out with failed server revocation clears caches and shows an honest warning', async () => {
    logout.mockResolvedValueOnce({ success: false, message: 'private server diagnostic' })
    await mount(<LogoutProbe />)
    client!.setQueryData(['session-owned-data'], 'cleared')
    await act(async () => document.querySelector('button')!.click())
    await until(() => warningToast.mock.calls.length === 1)
    expect(client!.getQueryData(['session-owned-data'])).toBeUndefined()
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({ to: '/login', replace: true })
    expect(warningToast.mock.calls[0]?.[0]).toBe(
        'Signed out in this browser, but the server session could not be revoked.',
    )
    expect(errorToast).not.toHaveBeenCalled()
})

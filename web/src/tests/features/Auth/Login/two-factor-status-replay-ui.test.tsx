import { afterEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'

if (!GlobalRegistrator.isRegistered)
    GlobalRegistrator.register({ settings: { device: { prefersReducedMotion: 'reduce' } } })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const status = mock(async () => ({ valid: false, methods: [] as string[] }))
mock.module('@/features/Auth/Login/middleware.ts', () => ({
    getTwoFactorChallengeStatusHandler: status,
    completeTwoFactorLoginHandler: async () => ({ success: false, message: 'Invalid code.' }),
}))
mock.module('@tanstack/react-router', () => ({
    useNavigate: () => async () => {},
    useRouter: () => ({ invalidate: async () => {} }),
    useRouterState: () => undefined,
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { ToastProvider, toast } = await import('@rentnerkev/toasts')
const { default: TwoFactorLoginPage } =
    await import('@/features/Auth/Login/Components/TwoFactorLoginPage.tsx')
let root: Root | undefined
let client: QueryClient | undefined

afterEach(async () => {
    await act(async () => {
        toast.dismissAll()
        root?.unmount()
    })
    root = undefined
    client?.clear()
    client = undefined
    status.mockReset()
    document.body.replaceChildren()
})

test.each(['expired', 'unavailable'] as const)(
    'dismissed %s status can be replayed as a visible toast without an inline banner',
    async (kind) => {
        if (kind === 'expired') status.mockResolvedValue({ valid: false, methods: [] })
        else status.mockRejectedValue(new Error('private transport diagnostic'))
        const container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        await act(async () => {
            root!.render(
                <QueryClientProvider client={client!}>
                    <TwoFactorLoginPage />
                    <ToastProvider {...TOAST_PROVIDER_PROPS} locale="en">
                        {null}
                    </ToastProvider>
                </QueryClientProvider>,
            )
            await new Promise((resolve) => setTimeout(resolve, 20))
        })
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20))
        })
        const message =
            kind === 'expired'
                ? 'This authentication request has expired. Start again.'
                : 'Authentication service temporarily unavailable. Try again.'
        expect(document.querySelector('.rentnerproxy-toast')?.textContent).toContain(message)
        expect(container.querySelector('[role="alert"], output')).toBeNull()
        await act(async () => {
            toast.dismissAll()
            await new Promise((resolve) => setTimeout(resolve, 300))
        })
        expect(document.querySelector('.rentnerproxy-toast')).toBeNull()
        const replay = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
            (button) => button.textContent === 'Show sign-in status',
        )!
        await act(async () => {
            replay.focus()
            replay.click()
        })
        expect(document.activeElement === replay).toBeTrue()
        expect(document.querySelectorAll('.rentnerproxy-toast')).toHaveLength(1)
        expect(document.querySelector('.rentnerproxy-toast')?.textContent).toContain(message)
        expect(container.textContent).not.toContain(message)
        expect(document.body.textContent).not.toContain('private transport diagnostic')
        expect(status).toHaveBeenCalledTimes(1)
    },
)

import { afterEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InputProvider } from '@rentnerkev/inputs'
import { TooltipProvider } from '@rentnerkev/tooltips/tooltip'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const submit = mock(async (_input: unknown) => ({ success: false, message: 'Invalid request.' }))
mock.module('@/features/Auth/Login/middleware.ts', () => ({
    loginHandler: submit,
    beginPasskeyLoginHandler: submit,
    finishPasskeyLoginHandler: submit,
    completeTwoFactorLoginHandler: submit,
    getTwoFactorChallengeStatusHandler: async () => ({ valid: true, methods: ['totp'] }),
}))
mock.module('@/features/Auth/Setup/middleware.ts', () => ({ setupOwnerHandler: submit }))
mock.module('@/features/Auth/ForgotPassword/middleware.ts', () => ({
    requestPasswordResetHandler: submit,
}))
mock.module('@/features/Auth/PasswordReset/middleware.ts', () => ({ resetPasswordHandler: submit }))
mock.module('@/features/Auth/AcceptInvite/middleware.ts', () => ({ acceptInviteHandler: submit }))
mock.module('@tanstack/react-router', () => ({
    useNavigate: () => async () => {},
    useRouter: () => ({ invalidate: async () => {} }),
    useRouterState: () => undefined,
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
mock.module('@rentnerkev/toasts/toast', () => ({
    toast: { error: () => {}, info: () => {}, success: () => {} },
}))

const { act, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { renderToString } = await import('react-dom/server')
const { default: LoginForm } = await import('@/features/Auth/Login/Components/LoginForm.tsx')
const { default: useLoginLogic } = await import('@/features/Auth/Login/Hooks/useLoginLogic.ts')
const { default: SetupForm } = await import('@/features/Auth/Setup/Components/SetupForm.tsx')
const { default: useSetupLogic } = await import('@/features/Auth/Setup/Hooks/useSetupLogic.ts')
const { default: ForgotPasswordForm } =
    await import('@/features/Auth/ForgotPassword/Components/ForgotPasswordForm.tsx')
const { default: useForgotPasswordLogic } =
    await import('@/features/Auth/ForgotPassword/Hooks/useForgotPasswordLogic.ts')
const { default: TwoFactorLoginForm } =
    await import('@/features/Auth/Login/Components/TwoFactorLoginForm.tsx')
const { default: useTwoFactorLoginLogic } =
    await import('@/features/Auth/Login/Hooks/useTwoFactorLoginLogic.ts')
const { default: PasswordResetForm } =
    await import('@/features/Auth/PasswordReset/Components/PasswordResetForm.tsx')
const { default: usePasswordResetLogic } =
    await import('@/features/Auth/PasswordReset/Hooks/usePasswordResetLogic.ts')
const { default: AcceptInviteForm } =
    await import('@/features/Auth/AcceptInvite/Components/AcceptInviteForm.tsx')
const { default: useAcceptInviteLogic } =
    await import('@/features/Auth/AcceptInvite/Hooks/useAcceptInviteLogic.ts')

let fillLogin: (() => void) | undefined
function Login() {
    const logic = useLoginLogic()
    useEffect(() => {
        fillLogin = () => {
            logic.form.setFieldValue('email', 'owner@example.test')
            logic.form.setFieldValue('password', 'test password')
        }
    }, [logic.form])
    return <LoginForm {...logic} onPasskeyLogin={() => void logic.handler.handlePasskeyLogin()} />
}
function Setup() {
    return <SetupForm {...useSetupLogic()} />
}
function ForgotPassword() {
    return <ForgotPasswordForm {...useForgotPasswordLogic()} />
}
function TwoFactor() {
    const logic = useTwoFactorLoginLogic()
    return (
        <TwoFactorLoginForm
            {...logic}
            onToggleMode={logic.handler.toggleMode}
            normalizeCredential={logic.handler.normalizeCredential}
        />
    )
}
function ResetPassword() {
    return <PasswordResetForm {...usePasswordResetLogic()} />
}
function AcceptInvite() {
    return <AcceptInviteForm {...useAcceptInviteLogic()} />
}

let root: Root | null = null
let client: QueryClient | null = null
function providers(children: ReactNode) {
    client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return (
        <QueryClientProvider client={client}>
            <TooltipProvider>
                <InputProvider locale="en">{children}</InputProvider>
            </TooltipProvider>
        </QueryClientProvider>
    )
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    client?.clear()
    client = null
    submit.mockClear()
    fillLogin = undefined
    document.body.replaceChildren()
})

test('valid client login still sends credentials through the existing handler after intercepting POST', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(providers(<Login />))
    })
    await act(async () => {
        fillLogin!()
        await new Promise((resolve) => setTimeout(resolve, 5))
    })
    const event = new Event('submit', { bubbles: true, cancelable: true })
    await act(async () => {
        container.querySelector('form')!.dispatchEvent(event)
        await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(event.defaultPrevented).toBeTrue()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith({
        data: { email: 'owner@example.test', password: 'test password' },
    })
    expect(container.querySelector('[id$="-error"]')).toBeNull()
})

for (const [label, Form, fields] of [
    ['login', Login, ['email', 'password']],
    ['setup', Setup, ['displayName', 'email', 'password', 'confirmPassword']],
    ['forgot password', ForgotPassword, ['email']],
    ['two-factor verification', TwoFactor, ['credential']],
    ['password reset', ResetPassword, ['password', 'confirmPassword']],
    ['invite acceptance', AcceptInvite, ['displayName', 'password', 'confirmPassword']],
] as const) {
    test(`${label} renders a safe native POST method before event handlers exist`, () => {
        const container = document.createElement('div')
        container.innerHTML = renderToString(providers(<Form />))
        const form = container.querySelector('form')!
        expect(form.method).toBe('post')
        expect(form.hasAttribute('action')).toBeFalse()
        expect(form.querySelector('[formmethod], [formaction]')).toBeNull()
        expect(
            [...form.querySelectorAll('input[name]')].map((input) => input.getAttribute('name')),
        ).toEqual([...fields])
        expect(submit).not.toHaveBeenCalled()
    })

    test(`${label} still intercepts native submission once client handlers are attached`, async () => {
        const container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
        await act(async () => {
            root!.render(providers(<Form />))
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        const form = container.querySelector('form')!
        const event = new Event('submit', { bubbles: true, cancelable: true })
        await act(async () => {
            form.dispatchEvent(event)
            await new Promise((resolve) => setTimeout(resolve, 5))
        })
        expect(form.method).toBe('post')
        expect(event.defaultPrevented).toBeTrue()
        expect(submit).not.toHaveBeenCalled()
        expect(
            container.querySelector('[id$="-error"]')?.textContent?.trim().length,
        ).toBeGreaterThan(0)
    })
}

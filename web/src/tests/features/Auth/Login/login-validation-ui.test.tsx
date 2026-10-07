import { afterEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InputProvider } from '@rentnerkev/inputs'
import { TooltipProvider } from '@rentnerkev/tooltips/tooltip'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const login = mock(async (_input: unknown) => ({ success: false, message: 'Invalid credentials.' }))
mock.module('@/features/Auth/Login/middleware.ts', () => ({
    loginHandler: login,
    beginPasskeyLoginHandler: async () => ({ success: false, message: 'Unavailable.' }),
    finishPasskeyLoginHandler: async () => ({ success: false, message: 'Unavailable.' }),
}))
mock.module('@tanstack/react-router', () => ({
    useNavigate: () => async () => {},
    useRouter: () => ({ invalidate: async () => {} }),
    useRouterState: () => undefined,
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
mock.module('@rentnerkev/toasts/toast', () => ({ toast: { error: () => {}, info: () => {} } }))

const { act, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: useLoginLogic } = await import('@/features/Auth/Login/Hooks/useLoginLogic.ts')
const { default: LoginForm } = await import('@/features/Auth/Login/Components/LoginForm.tsx')
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
        <LoginForm
            state={logic.state}
            handler={logic.handler}
            form={logic.form}
            onPasskeyLogin={() => void logic.handler.handlePasskeyLogin()}
        />
    )
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    client?.clear()
    client = null
    state = undefined
    login.mockClear()
    document.body.replaceChildren()
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

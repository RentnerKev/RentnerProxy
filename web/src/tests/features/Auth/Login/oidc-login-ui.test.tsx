import { afterEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import AlternativeLoginMethods from '@/features/Auth/Login/Components/AlternativeLoginMethods.tsx'
import type { AlternativeLoginMethodsProps } from '@/features/Auth/Login/Types/login-component-props.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
let root: Root | null = null
const select = mock((_id: string) => {})
const refresh = mock(() => {})
const cancel = mock(() => {})

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    select.mockClear()
    refresh.mockClear()
    cancel.mockClear()
    document.body.replaceChildren()
})

const providerId = '0194f777-4074-7000-8000-000000000003'
const initialState: AlternativeLoginMethodsProps['state'] = {
    validationEpochs: {},
    isPending: false,
    isPasskeyPending: false,
    isOidcPending: false,
    isProviderCatalogPending: false,
    isProviderCatalogUnavailable: false,
    oidcFeedback: null,
    alternativeSignInItems: [
        { id: 'passkey', label: 'Sign in with passkey' },
        { id: providerId, label: 'Sign in with Office <identity>' },
    ],
}
async function render(state = initialState) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
        root!.render(
            withTestLanguage(
                <>
                    <form id="password-login">
                        <input name="email" />
                        <input name="password" />
                    </form>
                    <AlternativeLoginMethods
                        state={state}
                        handler={{
                            handleSubmit: () => {},
                            validateEmail: () => undefined,
                            validatePassword: () => undefined,
                            handlePasskeyLogin: async () => {},
                            handleOidcSubmit: () => {},
                            handleAlternativeSignIn: select,
                            handleRefreshProviders: refresh,
                            handleCancelOidc: cancel,
                        }}
                        refs={{ oidcForm: { current: null }, oidcProviderId: { current: null } }}
                    />
                </>,
            ),
        ),
    )
    return container
}

test('provider login keeps a separate hidden native POST form containing only its UUID field', async () => {
    const container = await render()
    const forms = container.querySelectorAll('form')
    expect(forms).toHaveLength(2)
    expect(container.querySelector('form form')).toBeNull()
    const oidc = forms[1]!
    expect(oidc.hidden).toBeTrue()
    expect(oidc.getAttribute('method')).toBe('post')
    expect(oidc.getAttribute('action')).toBe('/api/auth/oidc/start')
    const inputs = oidc.querySelectorAll('input')
    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.type).toBe('hidden')
    expect(inputs[0]?.name).toBe('providerId')
    expect(oidc.querySelector('button')).toBeNull()
})

test.each([
    { name: 'password', isPending: true, isPasskeyPending: false, isOidcPending: false },
    { name: 'passkey', isPending: false, isPasskeyPending: true, isOidcPending: false },
    { name: 'provider', isPending: true, isPasskeyPending: false, isOidcPending: true },
])(
    'disables every direct sign-in and catalog retry while $name owns authentication',
    async (pending) => {
        const container = await render({
            ...initialState,
            ...pending,
            isProviderCatalogUnavailable: true,
        })
        const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
            (button) => button.textContent !== 'Cancel sign-in',
        )
        expect(buttons.length).toBeGreaterThan(1)
        expect(buttons.every((button) => button.disabled)).toBe(true)
        await act(async () => buttons.forEach((button) => button.click()))
        expect(select).not.toHaveBeenCalled()
        expect(refresh).not.toHaveBeenCalled()
        if (pending.isOidcPending) {
            const cancelButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
                (button) => button.textContent === 'Cancel sign-in',
            )!
            expect(cancelButton.disabled).toBe(false)
            await act(async () => cancelButton.click())
            expect(cancel).toHaveBeenCalledTimes(1)
        }
    },
)

test.each([
    ['Sign in with passkey', 'passkey'],
    ['Sign in with Office <identity>', providerId],
])(
    'direct native button forwards the stable ID for %s without rendering provider HTML',
    async (label, id) => {
        const container = await render()
        const item = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
            (entry) => entry.textContent === label,
        )!
        expect(item).toBeDefined()
        expect(item.type).toBe('button')
        expect(item.getAttribute('aria-haspopup')).toBeNull()
        expect(document.querySelector('identity')).toBeNull()
        await act(async () => item.click())
        expect(select).toHaveBeenCalledTimes(1)
        expect(select.mock.calls[0]?.[0]).toBe(id)
        expect(document.querySelector('[role="menu"]')).toBeNull()
    },
)

test('local login and direct passkey remain available with an empty provider catalog', async () => {
    const container = await render({
        ...initialState,
        alternativeSignInItems: [initialState.alternativeSignInItems[0]!],
    })
    expect(container.querySelector('#password-login')).not.toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(select.mock.calls[0]?.[0]).toBe('passkey')
    expect(document.querySelector('[role="alert"]')).toBeNull()
})

test('visible provider buttons do not steal local credential focus on hover', async () => {
    const container = await render()
    const email = container.querySelector<HTMLInputElement>('input[name="email"]')!
    const trigger = container.querySelector<HTMLButtonElement>('button')!
    await act(async () => {
        email.focus()
        trigger.dispatchEvent(
            new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
        )
        await new Promise((resolve) => setTimeout(resolve, 120))
    })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement === email).toBeTrue()
    expect(select).not.toHaveBeenCalled()
})

test('direct buttons preserve native focus and keyboard semantics without a menu focus trap', async () => {
    const container = await render()
    const trigger = container.querySelector<HTMLButtonElement>('button')!
    await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }),
        )
    })
    expect(trigger.type).toBe('button')
    expect(trigger.tabIndex).toBe(0)
    expect(document.activeElement === trigger).toBeTrue()
    const enter = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })
    await act(async () => trigger.dispatchEvent(enter))
    expect(enter.defaultPrevented).toBe(false)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement === trigger).toBeTrue()
    expect(select).not.toHaveBeenCalled()
    await act(async () => trigger.click())
    expect(select.mock.calls[0]?.[0]).toBe('passkey')
})

test.each(['loading', 'unavailable'] as const)(
    'local recovery remains usable when provider catalog is %s',
    async (status) => {
        const container = await render({
            ...initialState,
            alternativeSignInItems: [initialState.alternativeSignInItems[0]!],
            isProviderCatalogPending: status === 'loading',
            isProviderCatalogUnavailable: status === 'unavailable',
        })
        const email = container.querySelector<HTMLInputElement>('input[name="email"]')!
        const password = container.querySelector<HTMLInputElement>('input[name="password"]')!
        email.value = 'local-owner@example.test'
        password.value = 'private local recovery'
        const passkey = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
            (button) => button.textContent === 'Sign in with passkey',
        )!
        expect(passkey.disabled).toBe(false)
        if (status === 'unavailable') {
            const retry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
                (button) => button.textContent === 'Reload sign-in providers',
            )!
            await act(async () => retry.click())
            expect(refresh).toHaveBeenCalledTimes(1)
        }
        expect(email.value).toBe('local-owner@example.test')
        expect(password.value).toBe('private local recovery')
    },
)

import { afterEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import AlternativeLoginMethods from '@/features/Auth/Login/Components/AlternativeLoginMethods.tsx'
import type { AlternativeLoginMethodsProps } from '@/features/Auth/Login/Types/login-component-props.types.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
let root: Root | null = null
const select = mock((_id: string) => {})

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    select.mockClear()
    document.body.replaceChildren()
})

const providerId = '0194f777-4074-7000-8000-000000000003'
const initialState: AlternativeLoginMethodsProps['state'] = {
    validationEpochs: {},
    isPending: false,
    isPasskeyPending: false,
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
                    }}
                    refs={{ oidcForm: { current: null }, oidcProviderId: { current: null } }}
                />
            </>,
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

test.each(['isPending', 'isPasskeyPending'] as const)(
    'disables all alternative sign-in actions during %s',
    async (pending) => {
        const container = await render({ ...initialState, [pending]: true })
        const trigger = container.querySelector<HTMLButtonElement>('button')!
        expect(trigger.disabled).toBeTrue()
        await act(async () => trigger.click())
        expect(document.querySelector('[role="menu"]')).toBeNull()
        expect(select).not.toHaveBeenCalled()
    },
)

test.each([
    ['Sign in with passkey', 'passkey'],
    ['Sign in with Office <identity>', providerId],
])('menu selection forwards the stable ID for %s', async (label, id) => {
    const container = await render()
    const trigger = container.querySelector<HTMLButtonElement>('button')!
    expect(trigger.textContent).toBe('More sign-in options')
    await act(async () => trigger.click())
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (entry) =>
            document.getElementById(entry.getAttribute('aria-labelledby') ?? '')?.textContent ===
            label,
    )!
    expect(item).toBeDefined()
    expect(document.querySelector('identity')).toBeNull()
    await act(async () => item.click())
    expect(select).toHaveBeenCalledTimes(1)
    expect(select.mock.calls[0]?.[0]).toBe(id)
    expect(document.querySelector('[role="menu"]')).toBeNull()
})

test('local login and the passkey menu remain available with an empty provider catalog', async () => {
    const container = await render({
        ...initialState,
        alternativeSignInItems: [initialState.alternativeSignInItems[0]!],
    })
    expect(container.querySelector('#password-login')).not.toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(1)
    expect(document.querySelector('[role="alert"]')).toBeNull()
})

test('hover exposes alternative sign-in without stealing local credential focus', async () => {
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
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(document.activeElement === email).toBeTrue()
    expect(select).not.toHaveBeenCalled()
})

test('keyboard opens the alternatives and Escape returns focus to the trigger', async () => {
    const container = await render()
    const trigger = container.querySelector<HTMLButtonElement>('button')!
    await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }),
        )
    })
    const firstItem = document.querySelector<HTMLElement>('[role="menuitem"]')!
    expect(document.activeElement === firstItem).toBeTrue()
    await act(async () =>
        firstItem.dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }),
        ),
    )
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement === trigger).toBeTrue()
    expect(select).not.toHaveBeenCalled()
})

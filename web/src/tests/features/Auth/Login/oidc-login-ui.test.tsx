import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import OidcLoginProviders from '@/features/Auth/Login/Components/OidcLoginProviders.tsx'
import type { OidcLoginProvidersProps } from '@/features/Auth/Login/Types/login-component-props.types.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
let root: Root | null = null
afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
})

const initialState: OidcLoginProvidersProps['state'] = {
    isPending: false,
    isPasskeyPending: false,
    oidcFailed: false,
    oidcProviders: [{ id: '0194f777-4074-7000-8000-000000000003', name: 'Office <identity>' }],
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
                </form>
                <OidcLoginProviders state={state} onSubmit={() => {}} />
            </>,
        ),
    )
    return container
}

test('provider login uses a separate native POST form and only the provider UUID', async () => {
    const container = await render()
    const forms = container.querySelectorAll('form')
    expect(forms).toHaveLength(2)
    expect(container.querySelector('form form')).toBeNull()
    const oidc = forms[1]!
    expect(oidc.getAttribute('method')).toBe('post')
    expect(oidc.getAttribute('action')).toBe('/api/auth/oidc/start')
    const inputs = oidc.querySelectorAll('input')
    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.type).toBe('hidden')
    expect(inputs[0]?.name).toBe('providerId')
    expect(inputs[0]?.value).toBe(initialState.oidcProviders[0]!.id)
    expect(oidc.textContent).toBe('Sign in with Office <identity>')
    expect(oidc.querySelector('identity')).toBeNull()
})

test.each(['isPending', 'isPasskeyPending'] as const)(
    'disables provider submission during %s',
    async (pending) => {
        const container = await render({ ...initialState, [pending]: true })
        expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBeTrue()
    },
)

test('shows only generic callback failure and keeps local login when no provider is available', async () => {
    const container = await render({ ...initialState, oidcProviders: [], oidcFailed: true })
    expect(container.querySelector('#password-login')).not.toBeNull()
    expect(container.querySelectorAll('form')).toHaveLength(1)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'Sign-in failed. Try again or use your local account.',
    )
})

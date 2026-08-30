import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register()
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act, useEffect, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: withTestLanguage } = await import('./Helpers/withTestLanguage')
const { TooltipProvider } = await import('../shared/Tooltip')
const { default: ToastProvider } = await import('../shared/Toast/Components/ToastProvider')

const beginPasskeyMock = mock(async () => ({
    success: true,
    challengeId: 'registration-challenge',
    options: {},
}))
const finishPasskeyMock = mock(async () => ({
    success: false as const,
    message: 'account.passkeys.error.registrationFailed',
}))
const startRegistrationMock = mock(async () => ({}))
let setRecentlyAuthenticated: ((value: boolean) => void) | null = null

function useSecurityLogicMock() {
    const [recentlyAuthenticated, setRecentlyAuthenticatedState] = useState(true)

    useEffect(() => {
        setRecentlyAuthenticated = (value) => setRecentlyAuthenticatedState(value)
        return () => {
            setRecentlyAuthenticated = null
        }
    }, [])

    return {
        state: {
            error: null,
            isLoading: false,
            isPending: false,
            recoveryCodes: null,
            setup: null,
            status: {
                passkeys: [],
                recentlyAuthenticated,
                recoveryCodesRemaining: 0,
                totpEnabled: false,
            },
        },
        handler: {
            beginPasskey: beginPasskeyMock,
            beginTotp: mock(async () => ({ success: false, message: 'unused' })),
            confirmTotp: mock(async () => ({ success: false, message: 'unused' })),
            disableTotp: mock(async () => ({ success: false, message: 'unused' })),
            finishPasskey: finishPasskeyMock,
            regenerate: mock(async () => ({ success: false, message: 'unused' })),
            remove: mock(async () => ({ success: false, message: 'unused' })),
            rename: mock(async () => ({ success: false, message: 'unused' })),
            resetRecoveryCodes: mock(() => {}),
            resetSetup: mock(() => {}),
        },
    }
}

function useReauthenticationLogicMock() {
    const [credential, setCredential] = useState('current password')

    return {
        state: { credential, isPending: false, result: null },
        handler: {
            beginPasskey: mock(async () => ({ success: false, message: 'unused' })),
            finishPasskey: mock(async () => ({ success: false, message: 'unused' })),
            reset: () => setCredential(''),
            setCredential,
            verifyPassword: async () => {
                setRecentlyAuthenticated?.(true)
                return { success: true as const, message: 'Reauthenticated.' }
            },
        },
    }
}

mock.module('@simplewebauthn/browser', () => ({
    startAuthentication: mock(async () => ({})),
    startRegistration: startRegistrationMock,
}))
mock.module('../features/UserSettings/Hooks/useSecurityLogic', () => ({
    default: useSecurityLogicMock,
}))
mock.module('../features/UserSettings/Hooks/useReauthenticationLogic', () => ({
    default: useReauthenticationLogicMock,
}))

const { default: SecuritySettingsPanel } =
    await import('../features/UserSettings/Components/SecuritySettingsPanel')

let activeRoot: Root | null = null

async function render(): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = createRoot(container)

    await act(async () => {
        activeRoot?.render(
            withTestLanguage(
                <TooltipProvider>
                    <ToastProvider>
                        <SecuritySettingsPanel />
                    </ToastProvider>
                </TooltipProvider>,
            ),
        )
    })

    return container
}

async function click(element: Element): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await Promise.resolve()
    })
}

async function waitFor(condition: () => boolean, timeoutMs = 1_500): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!condition() && Date.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop -- Poll one rendered UI state at a time inside act.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    }
    expect(condition()).toBe(true)
}

function findButton(label: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === label,
    )
}

function errorToasts(): Array<HTMLElement> {
    return [...document.querySelectorAll<HTMLElement>('[data-toast-tone="error"]')]
}

beforeEach(() => {
    document.body.replaceChildren()
    setRecentlyAuthenticated = null
    beginPasskeyMock.mockReset()
    beginPasskeyMock.mockResolvedValue({
        success: true,
        challengeId: 'registration-challenge',
        options: {},
    })
    finishPasskeyMock.mockReset()
    finishPasskeyMock.mockResolvedValue({
        success: false,
        message: 'account.passkeys.error.registrationFailed',
    })
    startRegistrationMock.mockReset()
    startRegistrationMock.mockResolvedValue({})
})

afterEach(async () => {
    await act(async () => {
        activeRoot?.unmount()
    })
    activeRoot = null
    document.body.replaceChildren()
})

describe('security action feedback', () => {
    test.each([
        [
            'ERROR_INVALID_DOMAIN',
            'Passkeys cannot be registered using an IP address. Open the app on localhost for local development, or use its HTTPS domain.',
        ],
        [
            'ERROR_INVALID_RP_ID',
            'This address does not match the configured passkey domain. Open the app at its configured APP_URL and try again.',
        ],
        ['UNRECOGNIZED_BROWSER_ERROR', 'Passkey registration failed.'],
    ] as const)(
        'explains browser registration error %s without losing the name or exposing raw details',
        async (code, expectedMessage) => {
            startRegistrationMock.mockRejectedValueOnce(
                Object.assign(new Error('Internal diagnostic data must stay private.'), { code }),
            )
            await render()
            await click(findButton('Add passkey')!)
            const nameInput = document.querySelector<HTMLInputElement>('#passkey-name')!
            await setInputValue(nameInput, 'My laptop')
            await click(findButton('Continue')!)

            await waitFor(() => errorToasts().length === 1)
            expect(errorToasts()[0]?.textContent).toContain(expectedMessage)
            expect(errorToasts()[0]?.textContent).not.toContain(
                'Internal diagnostic data must stay private.',
            )
            expect(document.querySelector<HTMLInputElement>('#passkey-name')?.value).toBe(
                'My laptop',
            )
            expect(startRegistrationMock).toHaveBeenCalledTimes(1)
            expect(finishPasskeyMock).not.toHaveBeenCalled()
        },
    )
    test('restores the passkey name dialog once after a reauthenticated registration failure', async () => {
        await render()

        await click(findButton('Add passkey')!)
        await waitFor(() => document.querySelector<HTMLInputElement>('#passkey-name') !== null)

        const nameInput = document.querySelector<HTMLInputElement>('#passkey-name')!
        await setInputValue(nameInput, 'Office security key')
        await act(async () => {
            setRecentlyAuthenticated?.(false)
        })
        await click(findButton('Continue')!)
        await waitFor(() => findButton('Confirm') !== undefined)
        await click(findButton('Confirm')!)

        await waitFor(() => finishPasskeyMock.mock.calls.length === 1)
        await waitFor(() => errorToasts().length === 1)
        await waitFor(
            () =>
                document.querySelector<HTMLInputElement>('#passkey-name')?.value ===
                'Office security key',
        )

        expect(errorToasts()).toHaveLength(1)
        expect(errorToasts()[0]?.textContent).toContain('Passkey registration failed.')
    })
})

import { expect, mock, test } from 'bun:test'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'

let authenticated = false
let rejected = ''
let throwing = ''
const calls: { name: string; input: unknown }[] = []
const successToast = mock(() => {})
const errorToast = mock(() => {})
function operation(name: string) {
    return mock(async (input?: unknown) => {
        calls.push({ name, input })
        if (throwing === name) throw new Error('offline')
        return { success: rejected !== name, message: name, challengeId: 'challenge', options: {} }
    })
}
const operations = Object.fromEntries(
    [
        'beginTotp',
        'confirmTotp',
        'disableTotp',
        'regenerate',
        'beginPasskey',
        'finishPasskey',
        'rename',
        'remove',
        'verifyPassword',
        'beginAssertion',
        'finishAssertion',
    ].map((name) => [name, operation(name)]),
)
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@rentnerkev/toasts', () => ({ toast: { success: successToast, error: errorToast } }))
mock.module('@simplewebauthn/browser', () => ({
    startRegistration: operation('registration'),
    startAuthentication: operation('assertion'),
}))
mock.module(
    '@/features/UserSettings/Components/SecuritySettingsPanel/Hooks/useSecurityOperations.ts',
    () => ({
        default: () => ({
            state: {
                status: {
                    recentlyAuthenticated: authenticated,
                    passkeys: [{ id: 'key', name: 'Laptop' }],
                },
                setup: null,
                recoveryCodes: null,
                isLoading: false,
                isPending: false,
                error: null,
            },
            handler: {
                ...operations,
                resetSetup: mock(() => {}),
                resetRecoveryCodes: mock(() => {}),
            },
        }),
    }),
)
mock.module(
    '@/features/UserSettings/Components/SecuritySettingsPanel/Hooks/useReauthentication.ts',
    () => ({
        default: () => ({
            state: { credential: '', isPending: false },
            setter: { setCredential: mock(() => {}) },
            handler: {
                reset: mock(() => {}),
                verifyPassword: operations.verifyPassword,
                beginPasskey: operations.beginAssertion,
                finishPasskey: operations.finishAssertion,
            },
        }),
    }),
)
const { default: useSecurityPageLogic } =
    await import('@/features/UserSettings/Components/SecuritySettingsPanel/Hooks/useSecurityPageLogic.ts')

test('security actions require reauthentication and explicit destructive confirmation before mutation', async () => {
    authenticated = false
    const hook = await mountHook(() => useSecurityPageLogic('user'))
    try {
        await hook.run(() => hook.value.handler.requestEnableTotp())
        expect(hook.value.state.reauthAction).toBe('enable')
        await hook.run(() => hook.value.handler.confirmReauthentication())
        expect(calls.some((call) => call.name === 'beginTotp')).toBe(true)
        expect(hook.value.state.reauthAction).toBeNull()
        await hook.run(() => hook.value.handler.confirmTotp('123456'))
        expect(calls.find((call) => call.name === 'confirmTotp')?.input).toBe('123456')
        async function checkDestructiveAction(action: 'disable' | 'regenerate' | 'remove') {
            const before = calls.filter(
                (call) => call.name === (action === 'disable' ? 'disableTotp' : action),
            ).length
            await hook.run(() => hook.value.handler.requestDestructiveAction(action, 'key'))
            expect(hook.value.state.reauthAction).toBe(action)
            expect(hook.value.state.confirmation).toBeNull()
            await hook.run(() => hook.value.handler.reauthenticateWithPasskey())
            expect(hook.value.state.confirmation?.kind).toBe(action)
            expect(
                calls.filter(
                    (call) => call.name === (action === 'disable' ? 'disableTotp' : action),
                ),
            ).toHaveLength(before)
            await hook.run(() => hook.value.handler.confirmDestructiveAction())
            expect(hook.value.state.confirmation).toBeNull()
        }
        await checkDestructiveAction('disable')
        await checkDestructiveAction('regenerate')
        await checkDestructiveAction('remove')
        expect(calls.find((call) => call.name === 'remove')?.input).toEqual({ passkeyId: 'key' })
        await hook.run(() => hook.value.handler.requestRename('key'))
        expect(hook.value.state.nameRequest).toEqual({
            kind: 'rename',
            initialName: 'Laptop',
            passkeyId: 'key',
        })
        await hook.run(() => hook.value.handler.confirmPasskeyName('Work laptop'))
        expect(hook.value.state.reauthAction).toBe('rename')
        await hook.run(() => hook.value.handler.confirmReauthentication())
        expect(calls.find((call) => call.name === 'rename')?.input).toEqual({
            name: 'Work laptop',
            passkeyId: 'key',
        })
        await hook.run(() => hook.value.handler.requestAddPasskey())
        await hook.run(() => hook.value.handler.confirmReauthentication())
        expect(hook.value.state.nameRequest?.kind).toBe('add')
        await hook.run(() => hook.value.handler.confirmPasskeyName('Phone'))
        await hook.run(() => hook.value.handler.confirmReauthentication())
        expect(calls.find((call) => call.name === 'finishPasskey')?.input).toMatchObject({
            challengeId: 'challenge',
            name: 'Phone',
        })
        expect(hook.value.state.reauthAction).toBeNull()
        await hook.run(() => hook.value.handler.handleReauthenticationOpenChange(false))
        await hook.run(() => hook.value.handler.closePasskeyName())
        expect(hook.value.state.nameRequest).toBeNull()
    } finally {
        await hook.dispose()
    }
})

test('authenticated security failures preserve confirmation and retry names without silently reporting success', async () => {
    authenticated = true
    const hook = await mountHook(() => useSecurityPageLogic('user'))
    try {
        await hook.run(() => hook.value.handler.requestDestructiveAction('disable'))
        rejected = 'disableTotp'
        await hook.run(() => hook.value.handler.confirmDestructiveAction())
        expect(hook.value.state.confirmation?.kind).toBe('disable')
        throwing = 'disableTotp'
        await hook.run(() => hook.value.handler.confirmDestructiveAction())
        expect(errorToast).toHaveBeenCalledWith('account.security.error.change', {
            title: 'toast.titles.error',
        })
        await hook.run(() => hook.value.handler.handleConfirmationOpenChange(false))
        expect(hook.value.state.confirmation).toBeNull()
        throwing = ''
        rejected = 'finishPasskey'
        await hook.run(() => hook.value.handler.requestAddPasskey())
        await hook.run(() => hook.value.handler.confirmPasskeyName('Retry phone'))
        expect(hook.value.state.nameRequest?.kind).toBe('add')
        rejected = ''
        throwing = 'registration'
        await hook.run(() => hook.value.handler.confirmPasskeyName('Retry phone'))
        expect(hook.value.state.nameRequest?.kind).toBe('add')
        throwing = ''
        rejected = 'beginPasskey'
        await hook.run(() => hook.value.handler.confirmPasskeyName('Retry phone'))
        expect(hook.value.state.nameRequest?.kind).toBe('add')
        await hook.run(() => hook.value.handler.requestRename('key'))
        rejected = 'rename'
        await hook.run(() => hook.value.handler.confirmPasskeyName('Denied'))
        expect(hook.value.state.nameRequest?.kind).toBe('rename')
        throwing = 'rename'
        await hook.run(() => hook.value.handler.confirmPasskeyName('Offline'))
        expect(errorToast).toHaveBeenCalledWith('account.passkeys.error.rename', {
            title: 'toast.titles.error',
        })
        throwing = 'confirmTotp'
        await hook.run(() => hook.value.handler.confirmTotp('000000'))
        expect(errorToast).toHaveBeenCalledWith('account.twoFactor.error.verify', {
            title: 'toast.titles.error',
        })
        throwing = 'beginTotp'
        await hook.run(() => hook.value.handler.requestEnableTotp())
        expect(errorToast).toHaveBeenCalledWith('account.twoFactor.error.setupStart', {
            title: 'toast.titles.error',
        })
    } finally {
        throwing = ''
        rejected = ''
        await hook.dispose()
    }
})

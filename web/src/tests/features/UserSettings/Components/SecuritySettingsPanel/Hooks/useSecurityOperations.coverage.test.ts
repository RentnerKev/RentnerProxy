import { expect, mock, spyOn, test } from 'bun:test'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'

const calls: { name: string; input: unknown }[] = []
let fail = false
function endpoint(name: string) {
    return mock(async (input?: unknown) => {
        calls.push({ name, input })
        return fail
            ? { success: false, message: 'denied' }
            : {
                  success: true,
                  message: 'saved',
                  challengeId: 'challenge',
                  secret: 'fixture-secret',
                  otpAuthUrl: 'otpauth://fixture',
                  recoveryCodes: ['recovery-one', 'recovery-two'],
                  options: {},
              }
    })
}
const handlers = Object.fromEntries(
    [
        'beginPasskeyRegistrationHandler',
        'beginTotpSetupHandler',
        'confirmTotpSetupHandler',
        'disableTotpHandler',
        'finishPasskeyRegistrationHandler',
        'regenerateRecoveryCodesHandler',
        'removePasskeyHandler',
        'renamePasskeyHandler',
    ].map((name) => [name, endpoint(name)]),
)
mock.module('@/features/UserSettings/middleware.ts', () => ({
    ...handlers,
    getSecurityStatusHandler: mock(async () => ({
        passkeys: [],
        totpEnabled: false,
        recoveryCodesRemaining: 2,
    })),
}))
const { default: useSecurityOperations } =
    await import('@/features/UserSettings/Components/SecuritySettingsPanel/Hooks/useSecurityOperations.ts')
test('real security mutations bind OTP challenges, refresh successful writes and clear recovery material', async () => {
    const hook = await mountHook(() => useSecurityOperations('user-one'))
    const invalidate = spyOn(hook.client, 'invalidateQueries')
    try {
        await expect(hook.run(() => hook.value.handler.confirmTotp('123456'))).rejects.toThrow(
            'setupUnavailable',
        )
        expect(calls.some((call) => call.name === 'confirmTotpSetupHandler')).toBe(false)
        await hook.run(() => hook.value.handler.beginTotp())
        expect(hook.value.state.setup).toEqual({
            challengeId: 'challenge',
            secret: 'fixture-secret',
            otpAuthUrl: 'otpauth://fixture',
        })
        await hook.run(() => hook.value.handler.confirmTotp('654321'))
        expect(calls.find((call) => call.name === 'confirmTotpSetupHandler')?.input).toEqual({
            data: { challengeId: 'challenge', code: '654321' },
        })
        expect(hook.value.state.setup).toBeNull()
        expect(hook.value.state.recoveryCodes).toEqual(['recovery-one', 'recovery-two'])
        expect(invalidate).toHaveBeenCalled()
        await hook.run(() => hook.value.handler.resetRecoveryCodes())
        expect(hook.value.state.recoveryCodes).toBeNull()
        await hook.run(() => hook.value.handler.regenerate())
        expect(hook.value.state.recoveryCodes).toHaveLength(2)
        await hook.run(() => hook.value.handler.disableTotp())
        await hook.run(() => hook.value.handler.beginPasskey())
        const registration = {
            id: 'credential',
            rawId: 'YQ',
            type: 'public-key' as const,
            clientExtensionResults: {},
            response: { clientDataJSON: 'YQ', attestationObject: 'YQ' },
        }
        await hook.run(() =>
            hook.value.handler.finishPasskey({
                challengeId: 'challenge',
                name: 'Laptop',
                response: registration,
            }),
        )
        await hook.run(() =>
            hook.value.handler.rename({ passkeyId: 'credential', name: 'Renamed' }),
        )
        await hook.run(() => hook.value.handler.remove({ passkeyId: 'credential' }))
        expect(calls.find((call) => call.name === 'renamePasskeyHandler')?.input).toEqual({
            data: { passkeyId: 'credential', name: 'Renamed' },
        })
        expect(calls.find((call) => call.name === 'removePasskeyHandler')?.input).toEqual({
            data: { passkeyId: 'credential' },
        })
        invalidate.mockClear()
        fail = true
        await hook.run(() => hook.value.handler.beginTotp())
        expect(hook.value.state.setup).toBeNull()
        await hook.run(() => hook.value.handler.disableTotp())
        await hook.run(() => hook.value.handler.regenerate())
        await hook.run(() =>
            hook.value.handler.rename({ passkeyId: 'credential', name: 'Rejected' }),
        )
        await hook.run(() => hook.value.handler.remove({ passkeyId: 'credential' }))
        expect(invalidate).not.toHaveBeenCalled()
        await hook.run(() => hook.value.handler.resetSetup())
        await hook.run(() => hook.value.handler.resetRecoveryCodes())
        expect(hook.value.state.recoveryCodes).toBeNull()
    } finally {
        fail = false
        invalidate.mockRestore()
        await hook.dispose()
    }
})

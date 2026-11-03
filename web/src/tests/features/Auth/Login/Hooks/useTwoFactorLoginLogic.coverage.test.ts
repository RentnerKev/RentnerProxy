import { expect, mock, test } from 'bun:test'
import type { FormEvent } from 'react'
import { flushHook, mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'

const navigate = mock(async (_options: unknown) => {})
const invalidate = mock(async () => {})
const success = mock(() => {})
const error = mock(() => {})
const warning = mock(() => {})
let valid = true
const status = mock(async (_input: unknown) => ({ valid, methods: ['totp', 'recovery'] }))
const complete = mock(async (_input: unknown) => ({
    success: true,
    message: 'signed-in',
    restartLogin: false,
}))
mock.module('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    useRouter: () => ({ invalidate }),
}))
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@rentnerkev/toasts', () => ({ toast: { success, error, warning } }))
mock.module('@/features/Auth/Login/middleware.ts', () => ({
    getTwoFactorChallengeStatusHandler: status,
    completeTwoFactorLoginHandler: complete,
}))
const { default: useTwoFactorLoginLogic } =
    await import('@/features/Auth/Login/Hooks/useTwoFactorLoginLogic.ts')

test('second-factor login distinguishes proof payloads, restart failures and expired/unavailable status recovery', async () => {
    const hook = await mountHook(useTwoFactorLoginLogic)
    try {
        await flushHook()
        expect(hook.value.state.isValid).toBe(true)
        expect(hook.value.handler.normalizeCredential('totp', '12x34-567')).toBe('123456')
        expect(hook.value.handler.validateCredential({ value: 'bad' })).toBeDefined()
        await hook.run(() => hook.value.form.setFieldValue('credential', '123456'))
        const event = {
            preventDefault: mock(() => {}),
            stopPropagation: mock(() => {}),
        } as unknown as FormEvent<HTMLFormElement>
        await hook.run(() => hook.value.handler.handleSubmit(event))
        expect(complete).toHaveBeenCalledWith({ data: { code: '123456' } })
        expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
        expect(invalidate).toHaveBeenCalledTimes(1)
        await hook.run(() => hook.value.handler.toggleMode())
        expect(hook.value.form.getFieldValue('mode')).toBe('recovery')
        expect(hook.value.form.getFieldValue('credential')).toBe('')
        await hook.run(() => hook.value.form.setFieldValue('credential', ' recovery-code '))
        complete.mockResolvedValueOnce({
            success: false,
            message: 'restart-required',
            restartLogin: true,
        })
        await hook.run(() => hook.value.form.handleSubmit())
        expect(complete).toHaveBeenCalledWith({ data: { recoveryCode: 'recovery-code' } })
        expect(navigate).toHaveBeenCalledWith({ to: '/login', replace: true })
        complete.mockRejectedValueOnce(new Error('offline'))
        await hook.run(() => hook.value.form.handleSubmit())
        expect(error).toHaveBeenCalledWith('Authentication service temporarily unavailable.', {
            title: 'toast.titles.error',
        })
        valid = false
        await hook.run(() =>
            hook.client.invalidateQueries({ queryKey: ['auth', 'two-factor-challenge'] }),
        )
        await flushHook()
        expect(hook.value.state.isValid).toBe(false)
        expect(warning).toHaveBeenCalled()
        await hook.run(() => hook.value.handler.handleShowStatus())
        status.mockRejectedValue(new Error('status-offline'))
        await hook.run(() =>
            hook.client.invalidateQueries({ queryKey: ['auth', 'two-factor-challenge'] }),
        )
        await hook.run(() => new Promise((resolve) => setTimeout(resolve, 800)))
        expect(hook.value.state.isStatusError).toBe(true)
        expect(error).toHaveBeenCalled()
        status.mockResolvedValue({ valid, methods: ['totp', 'recovery'] })
        await hook.run(() =>
            hook.client.invalidateQueries({ queryKey: ['auth', 'two-factor-challenge'] }),
        )
        await flushHook()
        expect(hook.value.state.isStatusError).toBe(false)
    } finally {
        valid = true
        await hook.dispose()
    }
})

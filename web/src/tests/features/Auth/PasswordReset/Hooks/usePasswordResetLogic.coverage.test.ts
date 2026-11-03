import { expect, mock, test } from 'bun:test'
import type { FormEvent } from 'react'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
const reset = mock(async (_input: unknown) => ({ success: true, message: 'reset' }))
const navigate = mock(async (_options: unknown) => {})
const success = mock(() => {})
const error = mock(() => {})
mock.module('@/features/Auth/PasswordReset/middleware.ts', () => ({ resetPasswordHandler: reset }))
mock.module('@/shared/Auth/Hooks/useFragmentToken.ts', () => ({
    default: () => 'fragment-fixture-token',
}))
mock.module('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@rentnerkev/toasts', () => ({ toast: { success, error } }))
const { default: usePasswordResetLogic } =
    await import('@/features/Auth/PasswordReset/Hooks/usePasswordResetLogic.ts')

test('password reset binds fragment token and redirects only after accepted confirmation, preserving retry on failure', async () => {
    const hook = await mountHook(usePasswordResetLogic)
    try {
        expect(hook.value.handler.validatePassword({ value: '' })).toBeDefined()
        expect(hook.value.handler.validateConfirmPassword({ value: 'different' })).toBeDefined()
        await hook.run(() => {
            hook.value.form.setFieldValue('password', 'fixture-new-password')
            hook.value.form.setFieldValue('confirmPassword', 'fixture-new-password')
        })
        const event = {
            preventDefault: mock(() => {}),
            stopPropagation: mock(() => {}),
        } as unknown as FormEvent<HTMLFormElement>
        await hook.run(() => hook.value.handler.handleSubmit(event))
        expect(reset).toHaveBeenCalledWith({
            data: {
                password: 'fixture-new-password',
                confirmPassword: 'fixture-new-password',
                token: 'fragment-fixture-token',
            },
        })
        expect(navigate).toHaveBeenCalledWith({ to: '/login', replace: true })
        navigate.mockClear()
        reset.mockResolvedValueOnce({ success: false, message: 'expired' })
        await hook.run(() => hook.value.form.handleSubmit())
        expect(error).toHaveBeenCalledWith('expired', { title: 'toast.titles.error' })
        reset.mockRejectedValueOnce(new Error('offline'))
        await hook.run(() => hook.value.form.handleSubmit())
        expect(navigate).not.toHaveBeenCalled()
        expect(error).toHaveBeenCalledWith('Authentication service temporarily unavailable.', {
            title: 'toast.titles.error',
        })
    } finally {
        await hook.dispose()
    }
})

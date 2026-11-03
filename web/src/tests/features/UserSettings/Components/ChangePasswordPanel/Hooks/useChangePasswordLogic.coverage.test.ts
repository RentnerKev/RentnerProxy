import { expect, mock, test } from 'bun:test'
import type { FormEvent } from 'react'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'

const change = mock(async (_input: unknown) => ({ success: true, message: 'password-saved' }))
const success = mock(() => {})
const error = mock(() => {})
mock.module('@/features/UserSettings/middleware.ts', () => ({ changePasswordHandler: change }))
mock.module('@rentnerkev/toasts', () => ({ toast: { success, error } }))
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
const { default: useChangePasswordLogic } =
    await import('@/features/UserSettings/Components/ChangePasswordPanel/Hooks/useChangePasswordLogic.ts')

test('password form validates, resets only successful changes and surfaces rejection and service failure', async () => {
    const hook = await mountHook(useChangePasswordLogic)
    try {
        expect(hook.value.handler.validatePassword({ value: '' })).toBeDefined()
        expect(hook.value.handler.validateConfirmPassword({ value: 'different' })).toBe(
            'account.validation.passwordsDoNotMatch',
        )
        const values = {
            password: 'Next-fixture-password-74!',
            confirmPassword: 'Next-fixture-password-74!',
        }
        const fill = () => {
            for (const name of ['password', 'confirmPassword'] as const)
                hook.value.form.setFieldValue(name, values[name])
        }
        await hook.run(fill)
        expect(
            hook.value.handler.validateConfirmPassword({ value: values.password }),
        ).toBeUndefined()
        const event = {
            preventDefault: mock(() => {}),
            stopPropagation: mock(() => {}),
        } as unknown as FormEvent<HTMLFormElement>
        await hook.run(() => hook.value.handler.handleSubmit(event))
        expect(change).toHaveBeenCalledWith({ data: { password: values.password } })
        expect(hook.value.form.getFieldValue('password')).toBe('')
        expect(success).toHaveBeenCalledWith('password-saved', { title: 'toast.titles.success' })
        await hook.run(fill)
        change.mockResolvedValueOnce({ success: false, message: 'password-rejected' })
        await hook.run(() => hook.value.form.handleSubmit())
        expect(hook.value.form.getFieldValue('password')).toBe(values.password)
        expect(error).toHaveBeenCalledWith('password-rejected', { title: 'toast.titles.error' })
        change.mockRejectedValueOnce(new Error('offline'))
        await hook.run(() => hook.value.form.handleSubmit())
        expect(error).toHaveBeenCalledWith('account.password.error.update', {
            title: 'toast.titles.error',
        })
    } finally {
        await hook.dispose()
    }
})

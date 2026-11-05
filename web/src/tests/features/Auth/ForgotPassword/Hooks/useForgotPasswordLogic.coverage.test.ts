import { expect, mock, test } from 'bun:test'
import type { FormEvent } from 'react'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
const request = mock(async (_input: unknown) => ({ success: true, message: 'sent' }))
const success = mock(() => {})
const error = mock(() => {})
mock.module('@/features/Auth/ForgotPassword/middleware.ts', () => ({
    requestPasswordResetHandler: request,
}))
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@rentnerkev/toasts', () => ({ toast: { success, error } }))
const { default: useForgotPasswordLogic } =
    await import('@/features/Auth/ForgotPassword/Hooks/useForgotPasswordLogic.ts')

test('an empty reset request can be corrected and submitted without blur or validation toasts', async () => {
    request.mockClear()
    error.mockClear()
    const hook = await mountHook(useForgotPasswordLogic)
    try {
        await hook.run(() => hook.value.form.handleSubmit())
        expect(hook.value.form.state.canSubmit).toBeFalse()
        expect(request).not.toHaveBeenCalled()
        expect(error).not.toHaveBeenCalled()
        await hook.run(() => hook.value.form.setFieldValue('email', 'fixture@example.com'))
        expect(hook.value.form.state.canSubmit).toBeTrue()
        await hook.run(() => hook.value.form.handleSubmit())
        expect(request).toHaveBeenCalledTimes(1)
    } finally {
        await hook.dispose()
    }
})

test('reset request validates email and surfaces successful, rejected and unavailable delivery without exposing account state', async () => {
    const hook = await mountHook(useForgotPasswordLogic)
    try {
        expect(hook.value.handler.validateEmail({ value: 'invalid' })).toBeDefined()
        await hook.run(() => hook.value.form.setFieldValue('email', 'fixture@example.com'))
        const event = {
            preventDefault: mock(() => {}),
            stopPropagation: mock(() => {}),
        } as unknown as FormEvent<HTMLFormElement>
        await hook.run(() => hook.value.handler.handleSubmit(event))
        expect(request).toHaveBeenCalledWith({ data: { email: 'fixture@example.com' } })
        expect(success).toHaveBeenCalledWith('sent', { title: 'toast.titles.success' })
        request.mockResolvedValueOnce({ success: false, message: 'rate-limited' })
        await hook.run(() => hook.value.form.handleSubmit())
        expect(error).toHaveBeenCalledWith('rate-limited', { title: 'toast.titles.error' })
        request.mockRejectedValueOnce(new Error('offline'))
        await hook.run(() => hook.value.form.handleSubmit())
        expect(error).toHaveBeenCalledWith('Authentication service temporarily unavailable.', {
            title: 'toast.titles.error',
        })
    } finally {
        await hook.dispose()
    }
})

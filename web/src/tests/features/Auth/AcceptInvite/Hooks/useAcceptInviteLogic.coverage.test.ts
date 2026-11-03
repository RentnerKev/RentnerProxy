import { expect, mock, test } from 'bun:test'
import type { FormEvent } from 'react'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
const accept = mock(async (_input: unknown) => ({ success: true, message: 'accepted' }))
const navigate = mock(async (_options: unknown) => {})
const invalidate = mock(async () => {})
const error = mock(() => {})
mock.module('@/features/Auth/AcceptInvite/middleware.ts', () => ({ acceptInviteHandler: accept }))
mock.module('@/shared/Auth/Hooks/useFragmentToken.ts', () => ({
    default: () => 'invite-fixture-token',
}))
mock.module('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    useRouter: () => ({ invalidate }),
}))
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@rentnerkev/toasts', () => ({ toast: { error } }))
const { default: useAcceptInviteLogic } =
    await import('@/features/Auth/AcceptInvite/Hooks/useAcceptInviteLogic.ts')

test('invitation acceptance validates identity fields, binds token and establishes the shell only on success', async () => {
    const hook = await mountHook(useAcceptInviteLogic)
    try {
        expect(hook.value.handler.validateDisplayName({ value: '' })).toBeDefined()
        expect(hook.value.handler.validatePassword({ value: '' })).toBeDefined()
        expect(hook.value.handler.validateConfirmPassword({ value: 'different' })).toBeDefined()
        await hook.run(() => {
            hook.value.form.setFieldValue('displayName', 'Fixture')
            hook.value.form.setFieldValue('password', 'fixture-new-password')
            hook.value.form.setFieldValue('confirmPassword', 'fixture-new-password')
        })
        const event = {
            preventDefault: mock(() => {}),
            stopPropagation: mock(() => {}),
        } as unknown as FormEvent<HTMLFormElement>
        await hook.run(() => hook.value.handler.handleSubmit(event))
        expect(accept).toHaveBeenCalledWith({
            data: {
                displayName: 'Fixture',
                password: 'fixture-new-password',
                confirmPassword: 'fixture-new-password',
                token: 'invite-fixture-token',
            },
        })
        expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
        expect(invalidate).toHaveBeenCalledTimes(1)
        navigate.mockClear()
        invalidate.mockClear()
        accept.mockResolvedValueOnce({ success: false, message: 'expired' })
        await hook.run(() => hook.value.form.handleSubmit())
        expect(error).toHaveBeenCalledWith('expired', { title: 'toast.titles.error' })
        accept.mockRejectedValueOnce(new Error('offline'))
        await hook.run(() => hook.value.form.handleSubmit())
        expect(navigate).not.toHaveBeenCalled()
        expect(invalidate).not.toHaveBeenCalled()
        expect(error).toHaveBeenCalledWith('Authentication service temporarily unavailable.', {
            title: 'toast.titles.error',
        })
    } finally {
        await hook.dispose()
    }
})

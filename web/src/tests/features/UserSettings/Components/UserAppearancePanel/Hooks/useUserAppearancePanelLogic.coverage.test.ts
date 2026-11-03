import { expect, mock, test } from 'bun:test'
import type { FormEvent } from 'react'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
const update = mock(async (_input: unknown) => ({
    success: true,
    userId: 'user',
    accentColor: '#abcdef',
}))
const invalidate = mock(async () => {
    throw new Error('refresh unavailable')
})
const success = mock(() => {})
const error = mock(() => {})
mock.module('@/features/UserSettings/middleware.ts', () => ({
    updateCurrentUserAccentColorHandler: update,
}))
mock.module('@/shared/Theme/accentContext.ts', () => ({
    useAccent: () => ({ accentColor: '#112233' }),
}))
mock.module('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }))
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({
        language: 'en',
        t: (key: string, values?: unknown) => `${key}:${JSON.stringify(values)}`,
    }),
}))
mock.module('@rentnerkev/toasts', () => ({ toast: { success, error } }))
const { useUserAppearancePanelLogic } =
    await import('@/features/UserSettings/Components/UserAppearancePanel/Hooks/useUserAppearancePanelLogic.ts')

test('appearance picker accessibility parameters remain accurate and refresh failure does not misreport a persisted color', async () => {
    const hook = await mountHook(() => useUserAppearancePanelLogic('user'))
    try {
        expect(hook.value.state.pickerMessages.colorAreaValue?.(30, 80)).toBe(
            'userAppearance.picker.colorAreaValue:{"saturation":30,"value":80}',
        )
        expect(hook.value.state.pickerMessages.presetColor?.('#abcdef')).toBe(
            'userAppearance.picker.presetColor:{"color":"#abcdef"}',
        )
        await hook.run(() => hook.value.setter.setDraftColor('#abcdef'))
        expect(hook.value.state.canSave).toBe(true)
        const event = { preventDefault: mock(() => {}) } as unknown as FormEvent<HTMLFormElement>
        update.mockRejectedValueOnce(new Error('save offline'))
        await hook.run(() => hook.value.handler.handleSubmit(event))
        expect(error).toHaveBeenCalledTimes(1)
        await hook.run(() => hook.value.handler.handleSubmit(event))
        expect(update).toHaveBeenCalledWith({
            data: { expectedUserId: 'user', accentColor: '#abcdef' },
        })
        expect(invalidate).toHaveBeenCalledTimes(1)
        expect(success).toHaveBeenCalledTimes(1)
        expect(error).toHaveBeenCalledTimes(1)
        expect(hook.value.state.draftColor).toBe('#abcdef')
    } finally {
        await hook.dispose()
    }
})

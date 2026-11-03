import { expect, mock, test } from 'bun:test'
import type { FormEvent } from 'react'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'

let language = 'en'
const load = mock(async (next: string) => ({ language: next, resources: {} }))
const setLanguage = mock(async (next: string, _resources: unknown) => {
    language = next
})
const update = mock(async (_input: unknown) => ({
    success: true,
    message: 'language-saved',
    language: 'de',
}))
const invalidate = mock(async () => {})
const error = mock(() => {})
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ language, setLanguage, t: (key: string) => key }),
    loadLanguageBootstrap: load,
}))
mock.module('@/features/UserSettings/middleware.ts', () => ({
    updateCurrentUserLanguageHandler: update,
}))
mock.module('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }))
mock.module('@rentnerkev/toasts', () => ({ toast: { success: mock(() => {}), error } }))
const { default: useLanguageSettingsLogic } =
    await import('@/features/UserSettings/Components/LanguageSettingsPanel/Hooks/useLanguageSettingsLogic.ts')

test('language save loads translations before persistence and allows retry after bootstrap failure', async () => {
    const hook = await mountHook(useLanguageSettingsLogic)
    try {
        await hook.run(() => hook.value.handler.handleLanguageChange('invalid-language'))
        expect(hook.value.state.selectedLanguage).toBe('en')
        await hook.run(() => hook.value.handler.handleLanguageChange('de'))
        const event = {
            preventDefault: mock(() => {}),
            stopPropagation: mock(() => {}),
        } as unknown as FormEvent<HTMLFormElement>
        load.mockRejectedValueOnce(new Error('resource unavailable'))
        await hook.run(() => hook.value.handler.handleSubmit(event))
        expect(update).not.toHaveBeenCalled()
        expect(setLanguage).not.toHaveBeenCalled()
        expect(error).toHaveBeenCalledWith('language.loadFailed', { title: 'toast.titles.error' })
        await hook.run(() => {
            hook.value.handler.handleSubmit(event)
            hook.value.handler.handleSubmit(event)
        })
        expect(update).toHaveBeenCalledTimes(1)
        expect(update).toHaveBeenCalledWith({ data: { language: 'de' } })
        expect(setLanguage).toHaveBeenCalledWith('de', { language: 'de', resources: {} })
        expect(invalidate).toHaveBeenCalledTimes(1)
        expect(hook.value.state.selectedLanguage).toBe('de')
        expect(hook.value.state.isDirty).toBe(false)
    } finally {
        await hook.dispose()
    }
})

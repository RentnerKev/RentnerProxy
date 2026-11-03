import { expect, mock, test } from 'bun:test'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({
        language: 'en',
        t: (key: string, values?: unknown) => `${key}:${JSON.stringify(values)}`,
    }),
}))
const { default: useControlLocalization } =
    await import('@/layouts/RootLayout/Hooks/useControlLocalization.ts')

test('control localization preserves numeric and OTP interpolation parameters for accessible validation messages', async () => {
    const hook = await mountHook(useControlLocalization)
    try {
        const input = hook.value.inputMessages
        expect(input.minLength?.(8)).toBe('validation.minLength:{"count":8}')
        expect(input.minValue?.(2)).toBe('validation.numberMin:{"count":2}')
        expect(input.maxValue?.(10)).toBe('validation.numberMax:{"count":10}')
        expect(input.otpDigit?.(2, 6)).toBe('inputs.otpDigit:{"position":2,"count":6}')
        expect(input.otpIncomplete?.(6)).toBe('inputs.otpIncomplete:{"count":6}')
        expect(hook.value.selectMessages.minSelection?.(1)).toBe('validation.minItems:{"count":1}')
        expect(hook.value.selectMessages.maxSelection?.(5)).toBe('validation.maxItems:{"count":5}')
        expect(hook.value.language).toBe('en')
    } finally {
        await hook.dispose()
    }
})

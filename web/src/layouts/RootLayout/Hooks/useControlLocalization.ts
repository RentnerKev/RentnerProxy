import type { InputMessages } from '@rentnerkev/inputs'
import type { SelectMessages } from '@rentnerkev/select'
import { useMemo } from 'react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function useControlLocalization() {
    const { language, t } = useTranslationStore()
    const inputMessages = useMemo<InputMessages>(
        () => ({
            required: t('validation.required'),
            minLength: (count) => t('validation.minLength', { count }),
            invalidInput: t('validation.invalidValue'),
            invalidEmail: t('validation.emailInvalid'),
            invalidPhone: t('inputs.invalidPhone'),
            onlyNumbers: t('inputs.onlyNumbers'),
            minValue: (count) => t('validation.numberMin', { count }),
            maxValue: (count) => t('validation.numberMax', { count }),
            onlyMoneyCharacters: t('inputs.onlyMoneyCharacters'),
            passwordStrength: t('inputs.passwordStrength'),
            passwordStrengthEmpty: t('inputs.passwordStrengthEmpty'),
            passwordStrengthVeryWeak: t('inputs.passwordStrengthVeryWeak'),
            passwordStrengthWeak: t('inputs.passwordStrengthWeak'),
            passwordStrengthOkay: t('inputs.passwordStrengthOkay'),
            passwordStrengthStrong: t('inputs.passwordStrengthStrong'),
            passwordStrengthVeryStrong: t('inputs.passwordStrengthVeryStrong'),
            showPassword: t('common.showPassword'),
            hidePassword: t('common.hidePassword'),
            hourSelect: t('inputs.hourSelect'),
            hourPlaceholder: t('inputs.hourPlaceholder'),
            minuteSelect: t('inputs.minuteSelect'),
            minutePlaceholder: t('inputs.minutePlaceholder'),
            otpCode: t('inputs.otpCode'),
            otpDigit: (position, count) => t('inputs.otpDigit', { position, count }),
            otpIncomplete: (count) => t('inputs.otpIncomplete', { count }),
        }),
        [t],
    )
    const selectMessages = useMemo<SelectMessages>(
        () => ({
            required: t('validation.required'),
            minSelection: (count) => t('validation.minItems', { count }),
            maxSelection: (count) => t('validation.maxItems', { count }),
            searchOptions: t('calendar.searchOptions'),
            searchPlaceholder: t('calendar.searchPlaceholder'),
            noResults: t('calendar.noResults'),
            noOptions: t('calendar.noOptions'),
            clearSelection: t('common.clearSelection'),
        }),
        [t],
    )

    return { language, t, inputMessages, selectMessages }
}

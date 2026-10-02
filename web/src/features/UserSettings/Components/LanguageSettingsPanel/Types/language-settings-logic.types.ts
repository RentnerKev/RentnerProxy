import type { FormEventHandler } from 'react'
import type { AppLanguage } from '@/shared/Language/Types/language.types.ts'
export interface LanguageSettingsLogicResult {
    state: {
        selectedLanguage: AppLanguage
        isDirty: boolean
        isSaving: boolean
        options: { value: AppLanguage; label: string }[]
    }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        handleLanguageChange: (value: string) => void
    }
}

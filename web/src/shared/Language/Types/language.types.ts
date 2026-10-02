import type { Resource } from 'i18next'
import type { AVAILABLE_LANGUAGES } from '@/config/language.config.ts'
import type { createTranslationStore } from '../Hooks/useTranslationStore.ts'
export type AppLanguage = (typeof AVAILABLE_LANGUAGES)[number]

export type Translate = (key: string, options?: Record<string, unknown>) => string

export interface LanguageBootstrap {
    readonly language: AppLanguage
    readonly resources: Resource
}

export type TranslationStore = ReturnType<typeof createTranslationStore>

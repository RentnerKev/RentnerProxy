import type { AppLanguage } from '@/shared/Language/Types/language.types.ts'

export type LanguageUpdateResult =
    | { readonly success: true; readonly language: AppLanguage; readonly message: string }
    | { readonly success: false; readonly message: string }

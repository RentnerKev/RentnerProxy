import type { AppLanguage } from '../../../language/useTranslationStore'

export type LanguageUpdateResult =
    | { readonly success: true; readonly language: AppLanguage; readonly message: string }
    | { readonly success: false; readonly message: string }

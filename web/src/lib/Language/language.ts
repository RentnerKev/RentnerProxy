import type { AppLanguage } from '@/shared/Language/Types/language.types.ts'

import { AVAILABLE_LANGUAGES } from '@/config/language.config.ts'
export function isAppLanguage(value: unknown): value is AppLanguage {
    return typeof value === 'string' && AVAILABLE_LANGUAGES.some((language) => language === value)
}

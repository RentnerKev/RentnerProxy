import type { UserThemeMode } from '@/config/Types/theme-config.types.ts'
import type { AppLanguage } from '@/shared/Language/Types/language.types.ts'

export type UserPreference = { language: AppLanguage } | { themeMode: UserThemeMode }

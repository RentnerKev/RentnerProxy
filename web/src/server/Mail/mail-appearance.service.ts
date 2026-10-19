import '@tanstack/react-start/server-only'
import { eq } from 'drizzle-orm'
import { systemSettings, users, userSettings } from '@/db/schema.ts'
import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import { DEFAULT_USER_THEME_MODE } from '@/config/theme.config.ts'
import { isUserThemeMode } from '@/lib/Theme/themeMode.ts'
import {
    parseStoredUserAppearance,
    userAppearanceSettingsKey,
} from '@/lib/UserSettings/appearance.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { MailAppearance } from './Types/mail-theme.types.ts'

export async function getUserMailAppearanceInTransaction(
    transaction: AuthTransaction,
    userId: string,
): Promise<MailAppearance> {
    const [settings] = await transaction
        .select({ themeMode: userSettings.themeMode, appearance: systemSettings.value })
        .from(users)
        .leftJoin(userSettings, eq(userSettings.userId, users.id))
        .leftJoin(systemSettings, eq(systemSettings.key, userAppearanceSettingsKey(userId)))
        .where(eq(users.id, userId))
        .limit(1)
    return {
        themeMode: isUserThemeMode(settings?.themeMode)
            ? settings.themeMode
            : DEFAULT_USER_THEME_MODE,
        accentColor: parseStoredUserAppearance(settings?.appearance) ?? DEFAULT_ACCENT_COLOR,
    }
}

import type { UserAccentColor } from '@/config/Types/appearance-config.types.ts'

export type AccentColorUpdateResult =
    | ({ readonly success: true } & UserAccentColor)
    | { readonly success: false; readonly message: string }

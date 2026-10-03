import type { NavigationGroupChange } from '@/config/Types/navigation-config.types.ts'

export type NavigationGroupUpdateResult =
    | ({ readonly success: true } & NavigationGroupChange)
    | { readonly success: false; readonly message: string }

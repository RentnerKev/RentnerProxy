import type { NavigationGroupChange } from '@/shared/Types/navigation-config.types.ts'

export type NavigationGroupUpdateResult =
    | ({ readonly success: true } & NavigationGroupChange)
    | { readonly success: false; readonly message: string }

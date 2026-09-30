import type { NavigationGroupChange } from '../../../config/navigation.config'

export type NavigationGroupUpdateResult =
    | ({ readonly success: true } & NavigationGroupChange)
    | { readonly success: false; readonly message: string }

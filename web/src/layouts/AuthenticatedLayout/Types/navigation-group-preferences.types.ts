import type { NavigationGroupChange } from '@/config/Types/navigation-config.types.ts'

export interface NavigationGroupMutation extends NavigationGroupChange {
    readonly version: number
}

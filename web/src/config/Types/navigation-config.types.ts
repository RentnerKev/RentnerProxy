import type { NAVIGATION_GROUP_IDS } from '@/config/navigation.config.ts'
export type NavigationGroupId = (typeof NAVIGATION_GROUP_IDS)[number]

export type NavigationGroupPreferences = Readonly<Partial<Record<NavigationGroupId, boolean>>>

export interface NavigationGroupChange {
    readonly groupId: NavigationGroupId
    readonly expanded: boolean
}

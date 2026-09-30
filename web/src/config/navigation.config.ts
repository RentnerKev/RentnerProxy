import { z } from 'zod'

export const NAVIGATION_GROUP_IDS = ['operations', 'security', 'administration', 'records'] as const
export type NavigationGroupId = (typeof NAVIGATION_GROUP_IDS)[number]
export type NavigationGroupPreferences = Readonly<Partial<Record<NavigationGroupId, boolean>>>

export interface NavigationGroupChange {
    readonly groupId: NavigationGroupId
    readonly expanded: boolean
}

export const navigationGroupPreferenceInputSchema = z.strictObject({
    expectedUserId: z.string().uuid(),
    groupId: z.enum(NAVIGATION_GROUP_IDS),
    expanded: z.boolean(),
})

export function parseStoredNavigationGroupPreferences(value: unknown): NavigationGroupPreferences {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}

    const preferences: Partial<Record<NavigationGroupId, boolean>> = {}
    for (const groupId of NAVIGATION_GROUP_IDS) {
        if (Object.hasOwn(value, groupId)) {
            const expanded = (value as Record<string, unknown>)[groupId]
            if (typeof expanded === 'boolean') preferences[groupId] = expanded
        }
    }
    return preferences
}

import { z } from 'zod'
import { NAVIGATION_GROUP_IDS } from '@/config/navigation.config.ts'
import type {
    NavigationGroupId,
    NavigationGroupPreferences,
} from '@/shared/Types/navigation-config.types.ts'
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

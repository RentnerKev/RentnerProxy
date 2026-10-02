export const NAVIGATION_GROUP_IDS = ['operations', 'security', 'administration', 'records'] as const

export type {
    NavigationGroupId,
    NavigationGroupPreferences,
    NavigationGroupChange,
} from '@/shared/Types/navigation-config.types.ts'

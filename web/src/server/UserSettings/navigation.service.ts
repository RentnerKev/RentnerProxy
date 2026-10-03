import '@tanstack/react-start/server-only'

import { sql } from 'drizzle-orm'
import { navigationGroupPreferenceInputSchema } from '@/lib/Navigation/navigationPreferences.ts'
import type { NavigationGroupChange } from '@/config/Types/navigation-config.types.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { userSettings } from '@/db/schema.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'

export async function updateCurrentUserNavigationGroupService(
    input: unknown,
): Promise<NavigationGroupChange> {
    const { expectedUserId, groupId, expanded } = navigationGroupPreferenceInputSchema.parse(input)
    const user = await requirePermissionService(PERMISSIONS.APP_ACCESS)
    if (user.id !== expectedUserId) {
        throw new AuthDomainError('authentication_required', 'The signed-in user has changed.')
    }

    const preference = sql`jsonb_build_object(${groupId}::text, ${expanded}::boolean)`
    const rows = await getAuthDatabase()
        .insert(userSettings)
        .values({ userId: user.id, navigationGroupPreferences: preference })
        .onConflictDoUpdate({
            target: userSettings.userId,
            set: {
                navigationGroupPreferences: sql`(
                    CASE WHEN jsonb_typeof(${userSettings.navigationGroupPreferences}) = 'object'
                    THEN ${userSettings.navigationGroupPreferences} ELSE '{}'::jsonb END
                ) || ${preference}`,
            },
        })
        .returning({ userId: userSettings.userId })

    if (!rows.at(0)) {
        throw new AuthDomainError('service_unavailable', 'Navigation could not be updated.')
    }

    return { groupId, expanded }
}

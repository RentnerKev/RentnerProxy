import '@tanstack/react-start/server-only'

import { sql } from 'drizzle-orm'
import { navigationGroupPreferenceInputSchema } from '../../config/navigation.config'
import type { NavigationGroupChange } from '../../config/navigation.config'
import { PERMISSIONS } from '../../config/permissions.config'
import { userSettings } from '../../db/schema'
import { requirePermissionService } from '../Auth/Access/authorization.service'
import { getAuthDatabase } from '../Auth/Core/database.server'
import { AuthDomainError } from '../Auth/Core/errors.server'

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

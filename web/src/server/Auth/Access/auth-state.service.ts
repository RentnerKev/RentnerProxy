import '@tanstack/react-start/server-only'

import { users } from '../../../db/schema'
import type { AuthState } from '../Core/Types/auth-service.types'
import { getAuthDatabase } from '../Core/database.server'
import { getCurrentSessionService } from './sessions.service'

export async function hasAnyUserService(): Promise<boolean> {
    const rows = await getAuthDatabase().select({ id: users.id }).from(users).limit(1)
    return rows.length > 0
}

export async function getAuthStateService(): Promise<AuthState> {
    if (!(await hasAnyUserService())) {
        return { setupRequired: true, session: null, user: null }
    }

    const session = await getCurrentSessionService()
    return {
        setupRequired: false,
        session,
        user: session?.user ?? null,
    }
}
